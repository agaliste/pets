import AppKit

// stdin: setup + frame JSON lines. stdout: screen geometry + menu state JSON lines.
// All drawing and AppKit calls stay on the main thread; the reader only decodes JSON.
struct PixelSprite: Decodable { let rows: [String]; let palette: [String: Int] }
struct SpritePlacement: Decodable { let sprite: String; let x: Double; let y: Double; let flip: Bool; var scale: Double? }
struct LyricBubble: Decodable { let screen: String; let x: Double; let y: Double; let title: String; let lines: [String] }
struct Message: Decodable {
    let type: String
    var atlas: [String: PixelSprite]?
    var pixel: Double?
    var colors: [String: Int]?
    var sprites: [SpritePlacement]?
    var bubbles: [LyricBubble]?
    var sessions: [String]?
    var status: String?
    var combat: [SpritePlacement]?
    var quotaRequest: Int?
}

// Coalesce frames if the main thread is busy (e.g. tracking a menu). No stale-frame backlog.
final class Inbox {
    private let lock = NSLock()
    private var setup: Message?
    private var frame: Message?
    private var scheduled = false

    func submit(_ message: Message, deliver: @escaping (Message) -> Void) {
        lock.lock()
        if message.type == "setup" { setup = message } else { frame = message }
        let needsDispatch = !scheduled
        scheduled = true
        lock.unlock()
        guard needsDispatch else { return }
        DispatchQueue.main.async { [self] in
            lock.lock()
            let messages = [setup, frame].compactMap { $0 }
            setup = nil; frame = nil; scheduled = false
            lock.unlock()
            for message in messages { deliver(message) }
        }
    }
}

func color(_ hex: Int) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
            green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: 1)
}

final class PetPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class PetView: NSView {
    var origin = NSPoint.zero
    var screenID = ""
    weak var owner: Overlay?
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill()
        dirtyRect.fill(using: .copy)
        guard let owner, let frame = owner.frame else { return }
        NSGraphicsContext.current?.imageInterpolation = .none
        drawSprites(frame.sprites ?? [], owner: owner)
        for bubble in frame.bubbles ?? [] where bubble.screen == screenID {
            drawBubble(bubble, owner: owner)
        }
        drawSprites(frame.combat ?? [], owner: owner)
    }

    private func drawSprites(_ sprites: [SpritePlacement], owner: Overlay) {
        for item in sprites {
            guard let image = owner.images[item.sprite] else { continue }
            let scale = item.scale ?? 1
            let rect = NSRect(x: item.x - origin.x, y: item.y - origin.y, width: image.size.width * scale, height: image.size.height * scale)
            guard rect.intersects(bounds) else { continue }
            NSGraphicsContext.saveGraphicsState()
            if item.flip {
                let transform = AffineTransform(translationByX: rect.midX * 2, byY: 0)
                var flip = transform
                flip.scale(x: -1, y: 1)
                (flip as NSAffineTransform).concat()
            }
            image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
            NSGraphicsContext.restoreGraphicsState()
        }
    }

    private func drawBubble(_ bubble: LyricBubble, owner: Overlay) {
        let width = min(340.0, bounds.width - 24), height = 78.0
        guard width > 40, bounds.height > height + 24 else { return }
        let anchor = NSPoint(x: bubble.x - origin.x, y: bubble.y - origin.y)
        let x = max(12, min(anchor.x - width / 2, bounds.width - width - 12))
        let y = max(12, min(anchor.y - height - 8, bounds.height - height - 12))
        let rect = NSRect(x: x, y: y, width: width, height: height)
        owner.theme("background").withAlphaComponent(0.96).setFill()
        let path = NSBezierPath(roundedRect: rect, xRadius: 9, yRadius: 9)
        path.fill()
        owner.theme("accent").setStroke()
        path.lineWidth = 1
        path.stroke()
        let tail = NSBezierPath()
        let tx = max(x + 12, min(anchor.x, x + width - 12))
        tail.move(to: NSPoint(x: tx, y: y + height))
        tail.line(to: NSPoint(x: tx + 5, y: y + height + 7))
        tail.stroke()
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        (bubble.title as NSString).draw(in: NSRect(x: x + 12, y: y + 9, width: width - 24, height: 17), withAttributes: [
            .font: NSFont.systemFont(ofSize: 11, weight: .medium), .foregroundColor: owner.theme("muted"), .paragraphStyle: paragraph,
        ])
        for (index, line) in bubble.lines.prefix(2).enumerated() {
            (line as NSString).draw(in: NSRect(x: x + 12, y: y + 29 + Double(index) * 20, width: width - 24, height: 20), withAttributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 13, weight: .medium), .foregroundColor: owner.theme("text"), .paragraphStyle: paragraph,
            ])
        }
    }
}

final class Overlay: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var panels: [PetPanel] = []
    var images: [String: NSImage] = [:]
    var colors: [String: Int] = [:]
    var frame: Message?
    var statusItem: NSStatusItem?
    var paused = false
    var hidden = false
    private var lastFrame = ProcessInfo.processInfo.systemUptime
    private var watchdog: Timer?
    private var lastQuotaRequest = 0
    private let inbox = Inbox()
    private let typing = TypingInput()

    func theme(_ name: String) -> NSColor { color(colors[name] ?? 0xffffff) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "⚽"
        status.button?.setAccessibilityLabel("pets")
        status.button?.toolTip = "pets · floating desktop pets"
        let menu = NSMenu()
        menu.delegate = self
        status.menu = menu
        statusItem = status
        rebuildScreens()
        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(accessibilityChanged), name: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil)
        sendOptions()
        typing.onTyping = { [weak self] ages, point in self?.emit(["type": "typing", "ages": ages, "x": point.x, "y": point.y]) }
        typing.onReset = { [weak self] in self?.emit(["type": "combatReset"]) }
        typing.onStatus = { [weak self] status, enabled in self?.emit(["type": "combatStatus", "status": status, "enabled": enabled]) }
        typing.start()
        // A killed or stalled parent must not leave frozen pets or an orphan overlay.
        watchdog = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            guard let self else { return }
            if ProcessInfo.processInfo.systemUptime - self.lastFrame > 10 { NSApp.terminate(nil) }
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8), let message = try? JSONDecoder().decode(Message.self, from: data) else {
                    FileHandle.standardError.write(Data("Invalid desktop frame\n".utf8))
                    DispatchQueue.main.async { NSApp.terminate(nil) }
                    return
                }
                self?.inbox.submit(message) { [weak self] in self?.receive($0) }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    func receive(_ message: Message) {
        lastFrame = ProcessInfo.processInfo.systemUptime
        if message.type == "setup", let atlas = message.atlas {
            colors = message.colors ?? [:]
            let scale = message.pixel ?? 4
            for (id, sprite) in atlas {
                let width = sprite.rows.map { $0.count }.max() ?? 0
                let size = NSSize(width: Double(width) * scale, height: Double(sprite.rows.count) * scale)
                guard size.width > 0, size.height > 0 else { continue }
                let image = NSImage(size: size, flipped: true) { _ in
                    NSGraphicsContext.current?.shouldAntialias = false
                    for (y, row) in sprite.rows.enumerated() {
                        for (x, key) in row.enumerated() {
                            guard key != ".", let hex = sprite.palette[String(key)] else { continue }
                            color(hex).setFill()
                            NSRect(x: Double(x) * scale, y: Double(y) * scale, width: scale, height: scale).fill()
                        }
                    }
                    return true
                }
                images[id] = image
            }
        } else if message.type == "frame" {
            if let request = message.quotaRequest, request != lastQuotaRequest {
                lastQuotaRequest = request
                let mouse = NSEvent.mouseLocation
                // Send only the display ID, never mouse coordinates or a movement stream.
                let view = panels.compactMap { $0.contentView as? PetView }.first { view in
                    guard let window = view.window else { return false }
                    return window.frame.contains(mouse)
                }
                emit(["type": "quotaScreen", "request": request, "screen": view?.screenID ?? ""])
            }
            frame = message
            statusItem?.button?.toolTip = "pets · \(message.status ?? "")"
            if !hidden { for panel in panels { panel.contentView?.needsDisplay = true } }
        }
    }

    func applicationDidChangeScreenParameters(_ notification: Notification) { rebuildScreens(); emit(["type": "combatReset"]) }
    func applicationWillTerminate(_ notification: Notification) { typing.stop() }

    private func rebuildScreens() {
        for panel in panels { panel.orderOut(nil); panel.close() }
        panels.removeAll()
        let screens = NSScreen.screens
        let top = screens.map { $0.frame.maxY }.max() ?? 0
        var geometry: [[String: Any]] = []
        var used = Set<String>()
        for screen in screens {
            let id = String(describing: screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] ?? 0)
            // Mirrored displays can share a rectangle; one overlay is enough.
            let rectKey = NSStringFromRect(screen.frame)
            if !used.insert(rectKey).inserted { continue }
            let panel = PetPanel(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            panel.isReleasedWhenClosed = false
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = false
            panel.ignoresMouseEvents = true
            panel.hidesOnDeactivate = false
            panel.isFloatingPanel = true
            panel.level = .floating
            panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
            if #available(macOS 13.0, *) { panel.collectionBehavior.insert(.canJoinAllApplications) }
            panel.animationBehavior = .none
            let view = PetView(frame: NSRect(origin: .zero, size: screen.frame.size))
            view.origin = NSPoint(x: screen.frame.minX, y: top - screen.frame.maxY)
            view.screenID = id
            view.owner = self
            view.setAccessibilityElement(false)
            panel.contentView = view
            if !hidden { panel.orderFrontRegardless() }
            panels.append(panel)
            geometry.append(["id": id, "x": view.origin.x, "y": view.origin.y, "w": screen.frame.width, "h": screen.frame.height])
        }
        emit(["type": "screens", "screens": geometry])
    }

    func menuWillOpen(_ menu: NSMenu) {
        typing.suspended = true
        menu.removeAllItems()
        let title = NSMenuItem(title: "pets", action: nil, keyEquivalent: "")
        menu.addItem(title)
        menu.addItem(withTitle: frame?.status ?? "Connecting…", action: nil, keyEquivalent: "")
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            menu.addItem(withTitle: "Motion off · macOS Reduce Motion", action: nil, keyEquivalent: "")
        }
        menu.addItem(.separator())
        for name in frame?.sessions ?? [] { menu.addItem(withTitle: name, action: nil, keyEquivalent: "") }
        if !(frame?.sessions?.isEmpty ?? true) { menu.addItem(.separator()) }
        menu.addItem(withTitle: typing.status, action: nil, keyEquivalent: "")
        let combat = menu.addItem(withTitle: typing.enabled ? "Disable typing combat" : "Enable typing combat…", action: #selector(toggleCombat), keyEquivalent: "")
        combat.target = self
        menu.addItem(.separator())
        let pause = menu.addItem(withTitle: paused ? "Resume movement" : "Pause movement", action: #selector(togglePause), keyEquivalent: "")
        pause.target = self
        let hide = menu.addItem(withTitle: hidden ? "Show pets" : "Hide pets", action: #selector(toggleHidden), keyEquivalent: "")
        hide.target = self
        menu.addItem(.separator())
        let quit = menu.addItem(withTitle: "Quit pets", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
    }

    func menuDidClose(_ menu: NSMenu) { typing.suspended = paused || hidden }

    @objc private func toggleCombat() { if typing.enabled { typing.disable() } else { typing.enableWithPermission() } }
    @objc private func togglePause() { paused.toggle(); typing.suspended = paused || hidden; sendOptions() }
    @objc private func toggleHidden() {
        hidden.toggle()
        typing.suspended = paused || hidden
        for panel in panels { if hidden { panel.orderOut(nil) } else { panel.orderFrontRegardless(); panel.contentView?.needsDisplay = true } }
        sendOptions()
    }
    @objc private func quit() { NSApp.terminate(nil) }
    @objc private func accessibilityChanged() { sendOptions() }
    private func sendOptions() {
        emit(["type": "options", "paused": paused, "hidden": hidden, "reducedMotion": NSWorkspace.shared.accessibilityDisplayShouldReduceMotion])
    }
    private func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }
}
