# Extended Components Reference

Detailed HIG-compliant specifications for components not fully covered in the main skill file.

## Table of Contents
- [Context Menus](#context-menus)
- [Pull-Down Menus](#pull-down-menus)
- [Pickers](#pickers)
- [Segmented Controls](#segmented-controls)
- [Toggles / Switches](#toggles--switches)
- [Progress Indicators](#progress-indicators)
- [Popovers](#popovers)
- [Sidebars](#sidebars)
- [Page Controls](#page-controls)
- [Toolbars](#toolbars)
- [Text Fields & Text Views](#text-fields--text-views)
- [Sliders](#sliders)
- [Steppers](#steppers)

---

## Context Menus

Triggered by long press (iOS) or right-click (macOS/iPadOS with pointer).

- Show a preview of the content above the menu when possible
- Group related actions with separators
- Destructive actions at the bottom in `--system-red`
- Maximum ~10-12 items; use submenus for overflow
- Include SF Symbol icons for each action (leading position)
- Menu items: 44px minimum row height on iOS

```css
.context-menu {
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  min-width: 250px;
  overflow: hidden;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 16px;
  font-size: var(--text-body);
  min-height: 44px;
}

.context-menu-item.destructive {
  color: var(--system-red);
}

.context-menu-separator {
  height: 1px;
  background: var(--separator);
  margin: 4px 0;
}
```

## Pull-Down Menus

Attached to buttons; appear below the triggering element.

- Use for action lists where a button triggers multiple options
- Current selection shown with checkmark
- Group with headers and separators
- Same styling as context menus but anchored to button position
- On macOS, these are standard dropdown menus

## Pickers

### Date & Time Pickers
- **Compact:** Tappable label that opens inline calendar/time wheels
- **Inline:** Calendar grid embedded directly in the view
- **Wheels:** Traditional spinning wheel interface
- Highlight today's date; show selected range for date ranges
- Calendar grid: 7 columns, minimum 44px cell size

### Wheel Pickers
- Centered selection indicator with slight magnification
- Haptic feedback on each tick
- Translucent fade at top and bottom edges
- Height: typically 216px (5 visible rows)

```css
.picker-wheel {
  height: 216px;
  overflow: hidden;
  position: relative;
}

.picker-wheel-item {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-title3);
}

.picker-wheel-selection {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  height: 44px;
  width: 100%;
  background: var(--system-gray5);
  border-radius: var(--radius-sm);
}
```

## Segmented Controls

- Used for switching between 2-5 mutually exclusive options
- Height: 32px (compact) or 44px (regular)
- Selected segment: solid background with shadow
- Equal width segments by default; can use proportional width for variable-length labels
- Animate the selection indicator between segments

```css
.segmented-control {
  display: flex;
  background: var(--system-gray5);
  border-radius: var(--radius-sm);
  padding: 2px;
  height: 32px;
}

.segment {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 500;
  border-radius: 6px; /* inner radius: 8px outer - 2px padding */
  transition: all var(--duration-fast) var(--ease-default);
}

.segment.selected {
  background: var(--bg-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
```

## Toggles / Switches

- Width: 51px, Height: 31px (iOS standard)
- On: `--system-green` track; Off: `--system-gray4` track
- White circular thumb: 27px diameter
- Transition: 200ms ease-in-out
- Use for binary settings; never for actions
- Label on the left, toggle on the right

```css
.toggle-track {
  width: 51px;
  height: 31px;
  border-radius: 15.5px;
  background: var(--system-gray4);
  transition: background var(--duration-fast) var(--ease-in-out);
  position: relative;
}

.toggle-track.on {
  background: var(--system-green);
}

.toggle-thumb {
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform var(--duration-fast) var(--ease-in-out);
}

.toggle-track.on .toggle-thumb {
  transform: translateX(20px);
}
```

## Progress Indicators

### Activity Indicator (Spinner)
- Use for indeterminate tasks (loading, processing)
- Standard size: 20px; large: 36px
- Gray by default; can tint with system colors
- Center in the available space
- Include accessible label: "Loading..."

### Progress Bar
- Use for determinate tasks (upload: 45%)
- Height: 4px (thin) or 8px (standard)
- Track: `--system-gray5`; Fill: `--system-blue` (or tinted)
- Rounded caps: `border-radius: 50%` of height
- Animate fill smoothly

```css
.progress-bar {
  height: 4px;
  background: var(--system-gray5);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--system-blue);
  border-radius: 2px;
  transition: width var(--duration-normal) var(--ease-out);
}
```

## Popovers

- Used on iPad and Mac for contextual content anchored to a source element
- Arrow pointing to source element
- Maximum width: 320px (iPad), flexible on Mac
- Dismiss on tap outside
- `border-radius: 12px`, shadow: `0 10px 30px rgba(0, 0, 0, 0.2)`
- On iPhone, present as a sheet instead (system handles this automatically in native)

## Sidebars

Used on iPadOS and macOS for primary navigation in wide layouts.

- Width: 320px default (resizable on macOS)
- Translucent material background on macOS
- List style with SF Symbol icons + labels
- Selected row: `--system-blue` tinted background
- Collapsible sections with disclosure triangles
- In compact width, sidebar becomes a tab bar or hamburger menu

## Page Controls

Dot indicators for paging between screens (e.g., onboarding, image galleries).

- Active dot: 7px, `--label-primary`
- Inactive dots: 7px, `--label-quaternary`
- Spacing: 8px between dots
- Maximum ~10 dots; after that, dots compress or paginate
- Position: centered below content, above safe area

## Toolbars

- Three zones: leading (back/title), center (tools), trailing (actions)
- Maximum 3 item groups
- Use SF Symbols without borders (outline variant)
- Primary action uses `.prominent` style on trailing side
- Height: 44px + safe area on iOS
- Translucent blur background

## Text Fields & Text Views

- `min-height: 44px` for single-line fields
- `--bg-secondary` background, `border-radius: 12px`
- Placeholder text: `--label-tertiary`
- Focus ring: `box-shadow: 0 0 0 4px rgba(0, 122, 255, 0.3)`
- Clear button on trailing edge when field has content
- Character count for limited fields (e.g., "23/280")
- Multi-line text views: expandable height, scroll when content exceeds bounds

## Sliders

- Track height: 4px
- Minimum track: `--system-blue`; Maximum track: `--system-gray4`
- Thumb: 28px white circle with shadow
- Leading/trailing value labels optional
- Support continuous and discrete (stepped) modes
- Minimum width: 150px for usable interaction

## Steppers

- +/- buttons at 28x28px each
- Segmented style: joined buttons with divider
- Value label between or adjacent to buttons
- Disabled state when at min/max limits
- Haptic feedback on each step
