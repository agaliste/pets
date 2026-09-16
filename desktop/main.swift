import AppKit

let app = NSApplication.shared
let delegate = Overlay()
app.setActivationPolicy(.accessory)
app.delegate = delegate
app.run()
