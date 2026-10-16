import AppKit
import CoreGraphics
import Foundation

// Native window order is front-to-back. No screenshots or window contents are read.
let cuecardPID = Int(CommandLine.arguments[1])!
let target = CommandLine.arguments[2]
let bundleIDs = ["Google Chrome": "com.google.Chrome", "Microsoft Teams": "com.microsoft.teams2", "WhatsApp": "net.whatsapp.WhatsApp"]
let targetApp = NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == bundleIDs[target] }
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
let cuecardIndex = windows.firstIndex { ($0[kCGWindowOwnerPID as String] as? Int) == cuecardPID }
let targetIndex = windows.firstIndex { ($0[kCGWindowOwnerPID as String] as? Int) == targetApp.map { Int($0.processIdentifier) } && ($0[kCGWindowLayer as String] as? Int) == 0 }
let result: [String: Any] = [
    "foreground": NSWorkspace.shared.frontmostApplication?.localizedName ?? "",
    "targetFocused": NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleIDs[target],
    "target": target,
    "cuecardIndex": cuecardIndex ?? -1,
    "targetIndex": targetIndex ?? -1,
    "cuecardLayer": cuecardIndex.flatMap { windows[$0][kCGWindowLayer as String] as? Int } ?? -1,
    "aboveTarget": cuecardIndex != nil && targetIndex != nil && cuecardIndex! < targetIndex!
]
print(String(data: try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
