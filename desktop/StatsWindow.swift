import AppKit
import SwiftUI

struct TypingMetrics: Decodable {
    let keys: Int; let combos: Int; let bestCombo: Int; let activeMinutes: Int
    let activeDays: Int; let bestDay: Int; let peakMinute: Int; let dayStreak: Int
}
struct TypingDay: Decodable, Identifiable {
    var id: String { day }
    let day: String; let keys: Int; let activeMinutes: Int; let combos: Int; let bestCombo: Int
}
struct TypingHour: Decodable, Identifiable {
    var id: Int { hour }
    let hour: Int; let keys: Int
}
struct TypingCombo: Decodable { let start: Double; let end: Double; let hits: Int }
struct TypingAchievement: Decodable, Identifiable {
    let id: String; let title: String; let category: String; let description: String
    let target: Int; let progress: Int; let unlockedAt: Double?
}
struct TypingSnapshot: Decodable {
    let metrics: TypingMetrics; let today: TypingDay; let days: [TypingDay]; let hours: [TypingHour]
    let recentCombos: [TypingCombo]; let achievements: [TypingAchievement]
    let recordedSince: Double?; let generatedAt: Double
}
struct TypingStatsResponse: Decodable {
    var snapshot: TypingSnapshot?; var error: String?; var message: String?
}
struct AchievementNotice: Decodable {
    let id: String; let title: String; let count: Int
}

final class StatsModel: ObservableObject {
    @Published var response: TypingStatsResponse?
    @Published var waiting = true
    @Published var colors: [String: Int] = [:]
    @Published var tab = 0
    @Published var filter = 0
    @Published var confirmReset = false
    var request: ((String) -> Void)?
    func theme(_ name: String) -> Color { Color(nsColor: color(colors[name] ?? 0xffffff)) }
    func load(_ action: String) { waiting = true; request?(action) }
}

private func number(_ value: Int) -> String { value.formatted(.number.locale(Locale(identifier: "en_US"))) }
private func moment(_ milliseconds: Double) -> String {
    Date(timeIntervalSince1970: milliseconds / 1000).formatted(date: .abbreviated, time: .shortened)
}

private struct ActivityBar: View {
    let label: String
    let value: Int
    let maximum: Int
    let accent: Color
    var body: some View {
        VStack(spacing: 5) {
            GeometryReader { area in
                VStack {
                    Spacer(minLength: 0)
                    Rectangle().fill(accent.opacity(value == 0 ? 0.18 : 1))
                        .frame(height: max(2, area.size.height * CGFloat(value) / CGFloat(max(1, maximum))))
                }
            }
            Text(label).font(.system(size: 9, design: .monospaced)).lineLimit(1)
        }
        .frame(minWidth: 16)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(number(value)) keystrokes")
        .help("\(label): \(number(value)) keystrokes")
    }
}

struct StatsView: View {
    @ObservedObject var model: StatsModel

    private var accent: Color { model.theme("accent") }
    private var muted: Color { model.theme("muted") }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("KEYBOARD ARCADE").font(.system(size: 12, weight: .bold, design: .monospaced)).foregroundStyle(accent)
                    Text("Stats & Achievements").font(.system(size: 25, weight: .semibold))
                }
                Spacer()
                Button("Refresh") { model.load("statsRequest") }.disabled(model.waiting)
            }
            HStack(spacing: 8) {
                if model.waiting { ProgressView().controlSize(.small) }
                Text(status).font(.system(size: 12)).foregroundStyle(muted).textSelection(.enabled)
            }.frame(minHeight: 30, alignment: .leading)
            Picker("View", selection: $model.tab) {
                Text("Activity").tag(0)
                Text("Achievements").tag(1)
            }.pickerStyle(.segmented)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let snapshot = model.response?.snapshot {
                        if model.tab == 0 { activity(snapshot) } else { achievements(snapshot) }
                    } else if !model.waiting {
                        Text("History is unavailable. Check the storage error above, then choose Refresh to retry.")
                            .padding(.vertical, 40)
                    }
                }.padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            HStack(alignment: .center) {
                Text("Local history · Anonymous event times, never typed text.\nCounts follow typing combat’s monitoring, pause and secure-input rules.")
                    .font(.system(size: 11)).foregroundStyle(muted)
                Spacer()
                Button("Reset history…") { model.confirmReset = true }
                    .disabled(model.waiting || model.response?.snapshot == nil || model.response?.error != nil)
            }
        }
        .padding(24)
        .background(model.theme("background"))
        .foregroundStyle(model.theme("text"))
        .tint(accent)
        .preferredColorScheme(.dark)
        .frame(minWidth: 590, minHeight: 480)
        .alert("Reset all typing history?", isPresented: $model.confirmReset) {
            Button("Cancel", role: .cancel) {}.keyboardShortcut(.defaultAction)
            Button("Reset history", role: .destructive) { model.load("statsReset") }
        } message: {
            Text("This deletes all saved keystroke timestamps, combos, records and achievement unlocks from pets on this Mac. It cannot be undone. New typing will start a fresh history.")
        }
    }

    private var status: String {
        if let error = model.response?.error { return error }
        if model.waiting { return "Loading typing history…" }
        if let message = model.response?.message { return message }
        if let snapshot = model.response?.snapshot {
            return "Updated \(moment(snapshot.generatedAt)) · Hours and days use local time at capture."
        }
        return "Loading typing history…"
    }

    private func metric(_ label: String, _ value: Int, _ footnote: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12)).foregroundStyle(muted)
            Text(number(value)).font(.system(size: 27, weight: .bold, design: .monospaced))
            Text(footnote).font(.system(size: 11)).foregroundStyle(muted)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func activity(_ data: TypingSnapshot) -> some View {
        if data.metrics.keys == 0 {
            Text("Your next keystroke starts the story.").font(.title3.bold())
            Text("Enable typing combat in the football menu, then type in another app. History is collected only while monitoring is active.")
                .foregroundStyle(muted)
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), alignment: .leading)], alignment: .leading, spacing: 20) {
            metric("Keystrokes", data.metrics.keys, "\(number(data.today.keys)) today")
            metric("Combos", data.metrics.combos, "\(number(data.today.combos)) started today")
            metric("Longest combo", data.metrics.bestCombo, "hits in one streak")
            metric("Active days", data.metrics.activeDays, "\(number(data.metrics.dayStreak))-day best streak")
            metric("Active minutes", data.metrics.activeMinutes, "minutes containing typing")
            metric("Busiest minute", data.metrics.peakMinute, "keystrokes, not words per minute")
        }
        Divider()
        VStack(alignment: .leading, spacing: 12) {
            Text("Your daily rhythm").font(.headline)
            Text("Keystrokes by hour · all recorded days").font(.caption).foregroundStyle(muted)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(data.hours) { hour in
                    ActivityBar(label: String(format: "%02d", hour.hour), value: hour.keys,
                                maximum: data.hours.map(\.keys).max() ?? 1, accent: accent)
                }
            }.frame(height: 130)
            if let busiest = data.hours.filter({ $0.keys > 0 }).max(by: { $0.keys < $1.keys }) {
                Text("Most typing: \(String(format: "%02d:00–%02d:59", busiest.hour, busiest.hour)) · \(number(busiest.keys)) keystrokes")
                    .font(.caption).foregroundStyle(muted)
            }
        }
        VStack(alignment: .leading, spacing: 12) {
            Text("Last 30 days").font(.headline)
            Text("Blank days mean no recorded typing; pets may have been closed or paused.").font(.caption).foregroundStyle(muted)
            ScrollView(.horizontal) {
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(data.days) { day in
                        ActivityBar(label: String(day.day.suffix(5)), value: day.keys,
                                    maximum: data.days.map(\.keys).max() ?? 1, accent: accent)
                            .frame(width: 30)
                    }
                }.frame(height: 130)
            }
        }
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent combos").font(.headline)
            Text("One combo = a streak of 5+ hits. A gap over 1.4 seconds or a combat reset ends the streak.")
                .font(.caption).foregroundStyle(muted)
            if data.recentCombos.isEmpty { Text("No qualifying combos yet.").foregroundStyle(muted) }
            ForEach(Array(data.recentCombos.enumerated()), id: \.offset) { _, combo in
                HStack {
                    Text(moment(combo.start)).font(.system(size: 12))
                    Spacer()
                    Text("\(number(combo.hits)) hits").font(.system(size: 13, weight: .semibold, design: .monospaced))
                }
            }
        }
        if let since = data.recordedSince {
            Text("Recording since \(moment(since)). Earlier activity is not available.").font(.caption).foregroundStyle(muted)
        }
    }

    @ViewBuilder private func achievements(_ data: TypingSnapshot) -> some View {
        let unlocked = data.achievements.filter { $0.unlockedAt != nil }.count
        HStack {
            Text("\(unlocked) / \(data.achievements.count) unlocked").font(.system(size: 20, weight: .bold, design: .monospaced))
            Spacer()
            Picker("Achievement filter", selection: $model.filter) {
                Text("All").tag(0); Text("Unlocked").tag(1); Text("In progress").tag(2)
            }.frame(width: 170)
        }
        let visible = data.achievements.filter { model.filter == 0 || (model.filter == 1 ? $0.unlockedAt != nil : $0.unlockedAt == nil) }
        if visible.isEmpty { Text(model.filter == 1 ? "Your first unlock is ahead. Every counted key contributes." : "All achievements unlocked!").foregroundStyle(muted) }
        ForEach(visible) { item in
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline) {
                    Image(systemName: item.unlockedAt == nil ? "lock" : "trophy.fill").foregroundStyle(accent).accessibilityHidden(true)
                    Text(item.title).font(.headline)
                    Spacer()
                    Text(item.category).font(.caption).foregroundStyle(muted)
                }
                Text(item.description).font(.system(size: 12)).foregroundStyle(muted)
                if let date = item.unlockedAt {
                    Text("Unlocked \(moment(date))").font(.caption).foregroundStyle(accent)
                } else {
                    ProgressView(value: Double(min(item.progress, item.target)), total: Double(item.target))
                        .accessibilityLabel(item.title)
                    Text("\(number(min(item.progress, item.target))) / \(number(item.target))").font(.caption.monospacedDigit()).foregroundStyle(muted)
                }
            }.padding(.vertical, 7)
            Divider()
        }
    }
}

final class StatsWindowController: NSObject, NSWindowDelegate {
    let model = StatsModel()
    var onVisibility: ((Bool) -> Void)?
    private var window: NSWindow?
    private var toast: NSPanel?
    private var toastTimer: Timer?
    private var lastNotice: String?

    func show(colors: [String: Int]) {
        model.colors = colors
        if window == nil {
            let created = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 800, height: 720),
                styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
            created.title = "pets · Stats & Achievements"
            created.isReleasedWhenClosed = false
            created.contentMinSize = NSSize(width: 590, height: 480)
            created.contentView = NSHostingView(rootView: StatsView(model: model))
            created.delegate = self
            created.center()
            window = created
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        onVisibility?(true)
        model.load("statsRequest")
    }
    func receive(_ response: TypingStatsResponse) { model.response = response; model.waiting = false }
    func windowWillClose(_ notification: Notification) { onVisibility?(false) }

    func showNotice(_ notice: AchievementNotice?, colors: [String: Int], suppressed: Bool) {
        guard !suppressed, let notice else { toast?.orderOut(nil); return }
        guard notice.id != lastNotice else { return }
        lastNotice = notice.id
        toastTimer?.invalidate()
        toast?.close()
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        guard let screen else { return }
        let rect = NSRect(x: screen.visibleFrame.maxX - 350, y: screen.visibleFrame.maxY - 112, width: 330, height: 92)
        let panel = NSPanel(contentRect: rect, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isReleasedWhenClosed = false
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true
        panel.level = .floating; panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = NSHostingView(rootView:
            VStack(alignment: .leading, spacing: 6) {
                Text("ACHIEVEMENT UNLOCKED").font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color(nsColor: color(colors["accent"] ?? 0xffffff)))
                Text(notice.title).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                Text(notice.count > 1 ? "+\(notice.count - 1) more · Stats & Achievements in ⚽" : "View your collection in the ⚽ menu")
                    .font(.system(size: 11))
            }.padding(16).frame(width: 330, height: 92, alignment: .leading)
                .foregroundStyle(Color(nsColor: color(colors["text"] ?? 0xffffff)))
                .background(Color(nsColor: color(colors["background"] ?? 0))).cornerRadius(10)
        )
        toast = panel
        panel.orderFrontRegardless()
        toastTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in self?.toast?.orderOut(nil) }
    }
}
