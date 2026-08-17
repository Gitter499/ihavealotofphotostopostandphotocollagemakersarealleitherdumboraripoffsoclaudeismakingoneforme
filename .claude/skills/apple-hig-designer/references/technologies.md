# Apple Platform Technologies

HIG guidance for designing with Apple platform features: widgets, notifications, Live Activities, App Intents, and SharePlay.

## Table of Contents
- [Widgets](#widgets)
- [Notifications](#notifications)
- [Live Activities](#live-activities)
- [App Intents & Siri](#app-intents--siri)
- [SharePlay](#shareplay)
- [App Clips](#app-clips)

---

## Widgets

### Size Classes

| Size | Approximate Dimensions | Use Case |
|------|----------------------|-----------|
| Small | 169x169 pt (iPhone) | Single metric, quick glance |
| Medium | 360x169 pt | Summary with 2-3 data points |
| Large | 360x376 pt | Rich content, lists, charts |
| Extra Large | 360x376 pt (iPad) | Expanded widget content |
| Accessory Circular | 76x76 pt | Lock Screen, watchOS |
| Accessory Rectangular | 172x76 pt | Lock Screen, watchOS |
| Accessory Inline | Single line text | Lock Screen, watchOS |

### Design Guidelines
- **Glanceable:** Users should understand widget content in 1-2 seconds
- **No scrolling:** Widget content is static (except interactive widgets on iOS 17+)
- **Deep links:** Tapping a widget area should navigate to the relevant content in the app
- **Fresh content:** Update at appropriate intervals — show timestamp if data could be stale
- **Rounded corners:** Match system widget corner radius (use `ContainerRelativeShape` in SwiftUI)
- **Backgrounds:** Use solid or gradient backgrounds; avoid complex images as backgrounds
- **Typography:** Use system text styles; bold the most important value
- **Dark mode:** Widgets must support both light and dark modes

### Interactive Widgets (iOS 17+)
- Support `Button` and `Toggle` interactions directly in the widget
- Keep interactions simple — one tap should complete the action
- Show loading/confirmation state inline
- Don't require text input in widgets

### Smart Stacks
- Design widgets that make sense when stacked with others
- Provide relevance data so the system surfaces your widget at the right time
- Consider how your widget looks partially visible (during stack scroll)

## Notifications

### Notification Anatomy
```
┌─────────────────────────────────────┐
│ [App Icon] App Name          2m ago │
│                                     │
│ Notification Title (bold)           │
│ Body text with details about the    │
│ notification content...             │
│                                     │
│ [Thumbnail/Attachment]              │
│                                     │
│ [Action 1]  [Action 2]  [Action 3] │
└─────────────────────────────────────┘
```

### Design Guidelines
- **Title:** Short, specific — who/what. Use the sender name or event type.
- **Body:** One sentence with essential detail. Users decide whether to open the app based on this.
- **Grouping:** Group by thread/conversation/topic. Provide a summary for grouped notifications.
- **Actions:** Maximum 4 action buttons. Use clear verbs (Reply, Accept, Decline, Mark as Read).
- **Destructive actions:** Require confirmation. Show in red.
- **Silent notifications:** Use for non-urgent updates. Don't interrupt the user.

### Rich Notifications (Expanded View)
- Support images, video thumbnails, maps
- Custom UI via Notification Content Extension
- Interactive elements: buttons, text input (for reply)
- Maximum expanded height: ~300pt

### Notification Categories
- Organize notifications into categories with distinct action sets
- Allow users to customize notification settings per category
- Support Focus modes — respect the user's chosen notification filtering

## Live Activities

### Dynamic Island

**Compact view** (both leading and trailing sides):
- Leading: small icon or symbol (max ~36pt wide)
- Trailing: key value or status (max ~36pt wide)

**Expanded view** (when tapped/long-pressed):
```
┌─────────────────────────────────┐
│ Leading         Center  Trailing│
│                                 │
│         Expanded Content        │
│         (Bottom area)           │
└─────────────────────────────────┘
```

### Lock Screen
- Rectangular presentation below time
- Similar layout to a large widget
- Always-on display: dimmed version with essential info only
- Support both light and dark backgrounds

### Design Guidelines
- **Real-time:** Show live-updating data (delivery tracking, sports scores, timers)
- **Compact is king:** Most users see the compact view — make it informative
- **Updates:** Update at most once per second for timers; less frequently for data
- **End gracefully:** When the activity ends, show a final summary state
- **Duration:** Live Activities should last minutes to hours, not days
- **Content:** Use SF Symbols and system colors for consistency

### Implementation Hints
```swift
// Lock Screen / Dynamic Island layout
struct DeliveryActivityView: View {
    let context: ActivityViewContext<DeliveryAttributes>

    var body: some View {
        HStack {
            Image(systemName: "box.truck.fill")
            Text(context.state.status)
            Spacer()
            Text(context.state.estimatedArrival, style: .timer)
        }
        .padding()
    }
}
```

## App Intents & Siri

### App Intents
- Define actions your app can perform via Siri, Shortcuts, and Spotlight
- Each intent has parameters, a summary phrase, and result type
- Design natural-language phrases: "Order my usual from [App]"
- Provide parameter options that Siri can present as disambiguation choices

### Siri Integration
- Support voice interaction for common app actions
- Provide Siri Suggestions based on user behavior patterns
- Donate interactions so Siri can proactively suggest shortcuts
- Visual Siri responses: use snippet views for rich responses

### Shortcuts
- Design intents that compose well with other apps
- Provide sensible defaults for all parameters
- Support "Run in Background" for quick actions
- Show progress for long-running shortcuts

### Spotlight
- Index app content for Spotlight search
- Provide rich search results with images, ratings, and deep links
- Update the index when content changes

## SharePlay

### Design Principles
- **Shared context:** All participants see the same content simultaneously
- **Individual control:** Each person should be able to control their own view
- **Coordination:** Use GroupSession to synchronize playback/state
- **Visual indicators:** Show who's in the session (avatars) and who's controlling

### UI Guidelines
- SharePlay button: use `shareplay` SF Symbol
- Show participant list with connection status
- "SharePlay" label in the app to indicate active session
- Support late joiners — sync them to current state
- Handle disconnections gracefully (show reconnecting state)

### Content Types
- **Media:** Synchronized video/audio playback
- **Collaborative:** Shared whiteboards, documents, games
- **Experiences:** Shared AR/spatial experiences (visionOS)

## App Clips

### Design Guidelines
- **Instant:** Must launch in under 2 seconds
- **Focused:** One task only — complete it and suggest downloading the full app
- **Size limit:** Maximum 15MB (50MB for advanced App Clips)
- **No account required:** Don't require sign-in for the core experience
- **Invocation:** QR codes, NFC tags, App Clip codes, Safari links, Maps

### App Clip Card
- Appears as a card at the bottom of the screen
- Shows app icon, name, brief description, and action button
- Action button text should be specific: "Order", "Check In", "Rent"
- After use, suggest downloading the full app
