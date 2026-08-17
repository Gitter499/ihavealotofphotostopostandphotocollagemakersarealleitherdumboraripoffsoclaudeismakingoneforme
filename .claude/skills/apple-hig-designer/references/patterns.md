# UX Patterns Reference

Detailed HIG-compliant patterns for common user experience flows.

## Table of Contents
- [Sharing](#sharing)
- [Drag and Drop](#drag-and-drop)
- [Feedback & Haptics](#feedback--haptics)
- [Undo & Redo](#undo--redo)
- [Data Entry & Forms](#data-entry--forms)
- [Authentication](#authentication)
- [Permissions](#permissions)
- [File Management](#file-management)
- [Collaboration](#collaboration)

---

## Sharing

### Share Sheet
- Triggered by `square.and.arrow.up` symbol button
- Two rows: contacts/apps (horizontal scroll), then actions (vertical list)
- Actions grouped: Copy Link, Add to Reading List, etc.
- Custom actions should have clear SF Symbol icons
- Preview of shared content shown at top (link preview, image thumbnail)
- On macOS, use the system share popover

### Activity Views
- Third-party share extensions appear alongside system options
- User can customize which options appear and their order
- Destructive share actions (e.g., "Report") at bottom in red

## Drag and Drop

### iOS
- Long press to lift item (scale to 1.05, add shadow)
- Drag shows a floating preview of the content
- Drop targets highlight with blue border and slight scale
- Spring-loading: hover over a folder/tab to auto-open it
- Support multi-select drag (items stack with badge count)

### Implementation Cues
- Lift animation: `scale(1.05)` with `box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25)`
- Drop zone: `border: 2px dashed var(--system-blue)` with `background: rgba(0, 122, 255, 0.05)`
- Accepted: smooth animation to destination; Rejected: spring back to origin
- On macOS/iPadOS, drag and drop works between apps

## Feedback & Haptics

### Visual Feedback
- **Success:** Brief checkmark animation, green tint flash
- **Failure:** Shake animation (3 oscillations, 10px amplitude, 300ms)
- **Selection:** Background highlight with `--system-blue` at 10% opacity
- **Deletion:** Swipe-to-delete reveals red background with trash icon

### Haptic Patterns (native apps)
- **Selection:** Light tap when scrolling through options
- **Impact:** Light/medium/heavy for collisions, snaps, drops
- **Notification:** Success (ascending), warning (two-beat), error (descending)

### Audio Feedback
- System sounds for key actions (send, receive, delete)
- Never play sounds without user expectation
- Always respect silent mode

## Undo & Redo

- Support shake-to-undo on iOS (system behavior)
- Provide explicit undo buttons for destructive actions
- Show undo toast/snackbar: "Deleted. Undo" with 5-second timeout
- Support Command+Z / Command+Shift+Z with hardware keyboard
- Undo should be immediate and complete (no partial undo)

```css
.undo-toast {
  position: fixed;
  bottom: calc(var(--space-12) + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  background: var(--system-gray6);
  border-radius: var(--radius-full);
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  font-size: var(--text-subhead);
}

.undo-toast-action {
  color: var(--system-blue);
  font-weight: 600;
}
```

## Data Entry & Forms

### Text Input
- Label above field (or floating label for compact spaces)
- Placeholder text: brief example of expected input
- Inline validation: check mark for valid, red border + error message for invalid
- Auto-advance to next field on completion (e.g., phone number segments)
- Use appropriate keyboard type: `.emailAddress`, `.numberPad`, `.URL`, etc.

### Selection
- **Single choice (3-5 options):** Segmented control
- **Single choice (6+ options):** List with checkmark on selected row
- **Multiple choice:** List with checkboxes or toggles
- **Date/time:** Date picker in compact, inline, or wheel style

### Form Organization
- Group related fields in sections
- Section headers: uppercase `--text-footnote`, `--label-secondary`
- Section footers: explanatory text in `--text-footnote`, `--label-secondary`
- Required vs optional: mark optional fields "(Optional)" rather than marking required with asterisks
- Place primary action (Submit/Save) at bottom, full-width capsule button

## Authentication

### Sign In
- "Sign in with Apple" button should be the first option
- Biometric (Face ID / Touch ID) for returning users
- Password AutoFill support via `textContentType`
- "Forgot Password?" link below password field
- Loading state on sign-in button (replace text with spinner)

### Biometrics
- Request biometric auth at appropriate moments (app launch, sensitive actions)
- Always provide password fallback
- Explain why biometric access is needed before prompting

## Permissions

- Request permissions in context — when the feature is about to be used
- Explain the benefit before the system dialog appears ("We use your location to show nearby restaurants")
- Provide a custom pre-prompt explaining the value; system dialog follows
- If denied, show an inline message with a "Go to Settings" button
- Never block the entire app because a permission was denied
- Camera, microphone, location, notifications, contacts, photos, health data all require explicit user consent

## File Management

- Use system document picker for file selection
- Show file type icons based on UTI (Uniform Type Identifiers)
- Preview files in Quick Look when tapped
- Support iCloud Drive integration
- Show download progress for cloud files
- Conflict resolution: show both versions, let user choose

## Collaboration

- Show participant avatars in a horizontal stack (overlap by 25%)
- Real-time cursors with participant colors
- Presence indicators: green dot for active, gray for idle
- Share button prominently placed in navigation bar
- Activity feed for change history
- Manage access: viewer/editor/owner permission levels
