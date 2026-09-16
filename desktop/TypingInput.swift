import AppKit
import ApplicationServices
import Carbon

/// Passive typing pulses plus caret geometry. Never reads event characters or field text.
final class TypingInput: NSObject {
    var onTyping: (([Double], NSPoint) -> Void)?
    var onReset: (() -> Void)?
    var onStatus: ((String, Bool) -> Void)?
    private(set) var enabled = false
    private(set) var status = "Typing combat off"
    var suspended = false { didSet { if suspended != oldValue { clear() } } }
    private var wanted = true
    private var tap: CFMachPort?
    private var source: CFRunLoopSource?
    private var timer: Timer?
    private var pending: [Double] = []
    private var scheduled = false
    private var resolving = false
    private var generation = 0
    private var secure = false
    private let caretQueue = DispatchQueue(label: "AgentOffice.caret", qos: .userInitiated)

    func start() {
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(focusChanged), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.refresh() }
    }

    func enableWithPermission() {
        wanted = true
        if !CGPreflightListenEventAccess() { _ = CGRequestListenEventAccess() }
        if !AXIsProcessTrusted() {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        }
        refresh()
    }

    func disable() { wanted = false; stopTap(); setStatus("Typing combat off"); clear() }

    func stop() {
        wanted = false
        timer?.invalidate(); timer = nil
        NSWorkspace.shared.notificationCenter.removeObserver(self)
        stopTap(); clear()
    }

    private func setStatus(_ value: String) {
        if status != value { status = value; onStatus?(status, enabled) }
    }

    private func refresh() {
        let nextSecure = IsSecureEventInputEnabled()
        if nextSecure != secure { secure = nextSecure; clear() }
        guard wanted else { return }
        guard CGPreflightListenEventAccess() else {
            stopTap(); setStatus("Typing combat needs Input Monitoring"); return
        }
        guard AXIsProcessTrusted() else {
            stopTap(); setStatus("Typing combat needs Accessibility"); return
        }
        if tap == nil { installTap() }
        if enabled { setStatus(secure ? "Typing combat paused · secure input" : "Typing combat ready · caret / pointer fallback") }
    }

    private func installTap() {
        let mask = CGEventMask(1) << CGEventType.keyDown.rawValue
        guard let created = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let input = Unmanaged<TypingInput>.fromOpaque(context).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if input.wanted, let tap = input.tap { CGEvent.tapEnable(tap: tap, enable: true) }
                } else if type == .keyDown {
                    // Inspect only repeat/modifier metadata; no key codes or Unicode are read.
                    if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 &&
                        !event.flags.contains(.maskCommand) && !event.flags.contains(.maskControl) {
                        input.keyPulse()
                    }
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque()) else {
                setStatus("Typing monitor unavailable · retry Enable typing combat"); return
            }
        tap = created
        source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
        if let source { CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes) }
        enabled = true
        onStatus?(status, enabled)
    }

    private func stopTap() {
        let wasEnabled = enabled
        if let tap { CGEvent.tapEnable(tap: tap, enable: false); CFMachPortInvalidate(tap) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        tap = nil; source = nil; enabled = false
        if wasEnabled { clear(); onStatus?(status, enabled) }
    }

    @objc private func focusChanged() { clear() }

    private func clear() {
        pending.removeAll()
        generation += 1
        onReset?()
    }

    private func keyPulse() {
        guard enabled, !suspended, !IsSecureEventInputEnabled() else { return }
        // Bounded in-memory timestamps only. A held key cannot manufacture a combo.
        if pending.count < 32 { pending.append(ProcessInfo.processInfo.systemUptime) }
        schedule()
    }

    private func schedule() {
        guard !scheduled, !resolving, !pending.isEmpty else { return }
        scheduled = true
        // Let the focused app advance its caret before querying its rectangle.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.025) { [weak self] in
            guard let self else { return }
            self.scheduled = false
            self.resolveAnchor()
        }
    }

    private func resolveAnchor() {
        guard enabled, !suspended, !pending.isEmpty, !IsSecureEventInputEnabled() else { clear(); return }
        let times = pending
        pending.removeAll()
        let token = generation
        let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier
        let top = NSScreen.screens.map { $0.frame.maxY }.max() ?? 0
        let primaryTop = NSScreen.screens.first?.frame.maxY ?? top
        let mouse = NSEvent.mouseLocation
        let fallback = NSPoint(x: mouse.x, y: top - mouse.y)
        resolving = true
        caretQueue.async { [weak self] in
            let result = Self.caret(pid: pid)
            DispatchQueue.main.async {
                guard let self else { return }
                self.resolving = false
                defer { self.schedule() }
                guard token == self.generation, self.enabled, !self.suspended, !IsSecureEventInputEnabled(),
                      pid == NSWorkspace.shared.frontmostApplication?.processIdentifier else { return }
                if result.secure { self.clear(); return }
                let anchor = result.rect.map { NSPoint(x: $0.midX, y: top - primaryTop + $0.minY) } ?? fallback
                let now = ProcessInfo.processInfo.systemUptime
                // Send event ages, not an absolute clock from a different runtime.
                self.onTyping?(times.map { (now - $0) * 1000 }, anchor)
            }
        }
    }

    private static func caret(pid: pid_t?) -> (rect: CGRect?, secure: Bool) {
        guard let pid else { return (nil, false) }
        let application = AXUIElementCreateApplication(pid)
        // Slow or unsupported accessibility providers must not block typing or UI drawing.
        AXUIElementSetMessagingTimeout(application, 0.04)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() else { return (nil, false) }
        let element = focused as! AXUIElement
        AXUIElementSetMessagingTimeout(element, 0.04)
        var subrole: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subrole) == .success,
           (subrole as? String) == "AXSecureTextField" { return (nil, true) }
        var range: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &range) == .success,
              let range, CFGetTypeID(range) == AXValueGetTypeID() else { return (nil, false) }
        var selection = CFRange()
        guard AXValueGetValue(range as! AXValue, .cfRange, &selection), selection.length == 0 else { return (nil, false) }
        var bounds: CFTypeRef?
        guard AXUIElementCopyParameterizedAttributeValue(element, kAXBoundsForRangeParameterizedAttribute as CFString, range, &bounds) == .success,
              let bounds, CFGetTypeID(bounds) == AXValueGetTypeID() else { return (nil, false) }
        var rect = CGRect.zero
        guard AXValueGetValue(bounds as! AXValue, .cgRect, &rect), rect.height > 0, rect.height < 200,
              [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite }) else { return (nil, false) }
        return (rect, false)
    }
}
