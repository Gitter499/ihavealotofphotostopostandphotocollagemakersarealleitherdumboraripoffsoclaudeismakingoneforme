# Inputs & Platform-Specific Guidelines

Detailed guidance for input methods and per-platform design considerations.

## Table of Contents
- [Touch Gestures](#touch-gestures)
- [Keyboard](#keyboard)
- [Pointer (Trackpad & Mouse)](#pointer-trackpad--mouse)
- [Apple Pencil](#apple-pencil)
- [Game Controllers](#game-controllers)
- [visionOS](#visionos)
- [watchOS](#watchos)
- [tvOS](#tvos)
- [macOS](#macos)
- [iPadOS Multitasking](#ipados-multitasking)

---

## Touch Gestures

### Standard Gestures (never override these)
| Gesture | System Behavior |
|---------|----------------|
| Tap | Activate control, select item |
| Long press | Context menu, edit mode, drag initiation |
| Swipe from left edge | Back navigation |
| Swipe from right edge | (reserved on some views) |
| Swipe up from bottom | Home / app switcher |
| Pinch | Zoom in/out |
| Two-finger scroll | Scroll content |
| Three-finger swipe | Undo/redo (system) |

### Custom Gesture Guidelines
- Never override system gestures (edge swipes, home indicator)
- Provide visual affordances — users shouldn't have to discover gestures
- If a gesture performs a destructive action, require confirmation
- Always provide an alternative tap-based path for the same action
- Support both left-to-right and right-to-left layouts

### Swipe Actions on List Rows
- Leading swipe: positive actions (pin, mark as read) — use green/blue/orange
- Trailing swipe: negative actions (delete, archive) — delete in red on far right
- Full swipe: auto-triggers the primary action
- Maximum 3-4 actions per side

## Keyboard

### Hardware Keyboard (iPad/Mac)
- Support standard shortcuts: Cmd+C/V/X/Z, Cmd+A, Cmd+F
- Add app-specific shortcuts for frequent actions
- Show keyboard shortcut overlay: user holds Command key to see all available shortcuts
- Command+Return for primary action in forms/compose views
- Tab key navigates between form fields in logical order
- Escape dismisses modals and popovers

### Software Keyboard (iPhone/iPad)
- Use the correct keyboard type for each field:
  - `.default` for general text
  - `.emailAddress` for email
  - `.numberPad` for numbers only
  - `.phonePad` for phone numbers
  - `.URL` for web addresses
  - `.decimalPad` for decimal numbers
- Set `textContentType` for AutoFill (`.password`, `.emailAddress`, `.postalCode`)
- Add toolbar above keyboard for Done/Next/Previous actions
- Adjust scroll position so active field is visible above keyboard

## Pointer (Trackpad & Mouse)

### iPadOS Pointer
- Pointer morphs into contextual shapes: circle (default), rounded rect (over buttons), I-beam (over text)
- Hover effects: slight lift/scale on interactive elements
- Right-click (two-finger tap) opens context menus
- Scroll: natural (content follows finger direction)

### macOS Mouse
- Standard cursor shapes: arrow, hand, I-beam, crosshair, resize
- Hover states on all interactive elements (color change, underline for links)
- Right-click context menus are expected on every element
- Middle-click (scroll wheel) behavior should be natural
- Scroll bars: overlay style by default, legacy option available

## Apple Pencil

- **Drawing:** Support pressure (line weight) and tilt (shading)
- **Scribble:** Text fields should accept handwritten input that converts to text
- **Double-tap:** Switch between current tool and eraser (Pencil 2nd gen+)
- **Squeeze:** Tool palette on Pencil Pro
- **Hover:** Preview brush/tool position before touching canvas (Pencil Pro)
- **Palm rejection:** Always active when Pencil is in use
- **Latency:** Drawing should feel instantaneous — use prediction algorithms
- **Low-latency rendering:** Update at 120Hz on ProMotion displays

## Game Controllers

- Support MFi (Made for iPhone) controllers
- Map face buttons to primary UI actions (A=confirm, B=back)
- D-pad for navigation between elements
- Support both analog sticks where appropriate
- Show controller-appropriate button glyphs in UI
- Always maintain touch/tap as primary input fallback

---

## visionOS

### Spatial Design Principles
- **Windows:** Floating panels in 3D space. Default size ~1 meter wide at conversational distance. Rounded rectangle with glass material.
- **Volumes:** 3D content bounded in a box. Use for object viewing, games, creative tools.
- **Immersive Spaces:** Full/progressive immersion. Use `Open Immersive Space` deliberately.

### Interaction Model
- **Eyes + hands:** Look at a target, pinch to select (indirect interaction)
- **Direct touch:** Reach out and touch UI elements in nearby space
- **Minimum target size:** 60 points — larger than iOS because of eye tracking precision
- **Hover:** Elements highlight when looked at (system provides this for standard controls)
- **Avoid gaze-only interactions:** Always require a pinch or tap to confirm; gaze alone should never trigger actions

### Visual Guidelines
- Glass material (`ultraThinMaterial`) for window backgrounds — translucent, not opaque
- Avoid flat/solid backgrounds in windows — they look like cardboard in space
- Use depth and shadow to establish hierarchy between windows
- Text contrast must work against any environment (light or dark passthrough)
- Use system vibrancy for labels over glass

### Spatial Audio
- Place audio sources relative to content position in space
- Spatial audio reinforces where content is

### Ergonomics
- Keep primary content at eye level, slightly below center of vision
- Avoid requiring sustained upward/downward gaze
- Keep interactive elements within comfortable arm's reach for direct interaction
- Use progressive disclosure — don't overwhelm with too many floating windows

## watchOS

### Design Constraints
- Screen sizes: 40mm, 41mm, 44mm, 45mm, 49mm (Ultra)
- Content area is very small — prioritize glanceable information
- One column layout, vertical scrolling only
- Large touch targets: minimum 44px height, full-width buttons preferred

### Navigation
- **Vertical scrolling:** Primary navigation within an app
- **Horizontal swiping:** Between pages (TabView) — maximum 5 pages
- **Digital Crown:** Scrolling, value adjustment (precise control)
- **Side button:** Access Control Center; double-press for Apple Pay

### Complications
- Provide data in multiple complication families: circular, rectangular, inline, corner
- Update at appropriate intervals — not too frequently (battery)
- Tapping a complication should deep-link to relevant content in the app
- Design for always-on display: dimmed version with reduced updates

### Typography
- Use SF Compact (not SF Pro) for optimal legibility at small sizes
- Minimum text size: 16px for body, 12px for captions
- Bold text for titles and important information

### Interactions
- Optimize for ~2-3 second interactions
- Notifications are the primary way users interact with watchOS apps
- Support Siri / voice input for text entry
- Use haptic feedback for confirmations (`.success`, `.failure`)

## tvOS

### Focus-Based Navigation
- Users navigate with Siri Remote: swipe to move focus, click to select
- **Focus ring:** System provides a floating, animated focus indicator
- Focused items scale up (1.05-1.1x) and lift with shadow
- Parallax effect on focused items (subtle tilt responding to remote position)
- Navigation is directional — layout must make directional movement predictable

### Layout
- Safe area: 60px inset from all edges (overscan area)
- Content grid: cards arranged in horizontal rows
- Horizontal scrolling within rows, vertical scrolling between rows
- Top shelf: showcase content in the top row of the home screen

### Text & Readability
- Viewing distance: 3+ meters (10+ feet)
- Minimum text size: 30px for body text
- Use high contrast colors
- Keep text short — long paragraphs are hard to read from across the room

### Siri Remote
- Touch surface: swipe, click, long press
- Menu button: back navigation (always honored)
- Play/Pause button: media control
- Home button: exit to home screen (system controlled)
- Voice button: Siri activation

## macOS

### Window Management
- Support standard window controls: close, minimize, full-screen (traffic lights)
- Resizable windows with minimum size constraints
- Remember window position and size between launches
- Support multiple windows for document-based apps
- Toolbar: customizable, with icon+label or icon-only modes

### Menu Bar
- Every app has a menu bar — this is the primary place for all commands
- Standard menus: App, File, Edit, View, Window, Help
- Keyboard shortcuts shown in menu items
- Contextual menus on right-click for every element

### Keyboard-First Interaction
- macOS users expect to do everything with keyboard
- Tab navigation through all focusable elements
- Full keyboard access mode: Tab moves between all controls
- Standard shortcuts honored everywhere (Cmd+S, Cmd+N, Cmd+W, Cmd+Q)

### Visual Differences from iOS
- Buttons: bordered rectangle style (not capsule) for most contexts
- Toolbars: icon buttons with optional labels, customizable
- Sidebars: translucent source list for navigation
- Popovers: preferred over sheets for secondary content
- Scroll bars: overlay style, appear on scroll
- Density: smaller touch targets (mouse precision), tighter spacing

### Dock & Menu Bar Integration
- Provide a meaningful Dock icon
- Badge the Dock icon for notifications (count)
- Menu bar extras (status bar items) for background utilities
- Support Dock menu (right-click on icon) for quick actions

## iPadOS Multitasking

### Split View & Slide Over
- App must adapt to any width from 320px to full screen
- Use size classes: compact width (like iPhone) and regular width (like iPad)
- Slide Over: 320px width overlay — must be fully functional at this size
- Split View: 50/50 or 66/33 split — adapt layout accordingly

### Stage Manager
- Resizable, overlapping windows
- Design layouts that work at any reasonable aspect ratio
- Support drag and drop between windows and apps

### Keyboard & Pointer
- Full hardware keyboard support with shortcuts
- Pointer hover effects on all interactive elements
- Command+Tab for app switching, Command+H for home
