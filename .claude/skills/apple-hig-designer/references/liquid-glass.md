# Liquid Glass Design Language

Apple's 2025 visual redesign (iOS 26, iPadOS 26, macOS 26, watchOS 26, tvOS 26, visionOS 26).

## Overview

Liquid Glass is Apple's most significant visual overhaul since the flat design transition in iOS 7 (2013). It emphasizes translucency, depth, and fluid responsiveness, creating a unified rhythm between hardware and software through dynamic materials that adapt to their surroundings.

**Important:** Only apply Liquid Glass styling when the user explicitly requests it, targets iOS 26+, or asks for the "2025 Apple look." Default designs should use solid backgrounds for maximum compatibility and readability.

---

## Core Characteristics

### Dynamic Translucency
- UI elements use glass-like materials that reveal content behind them
- Background content is visible through blur and saturation effects
- Materials dynamically tint based on the colors behind them
- Creates a sense of physical depth and layering

### Enhanced Concentricity
- Stronger concentric radius relationships between nested elements
- Rounded corners flow naturally from outer to inner elements
- Creates visual harmony that echoes Apple hardware design (rounded device corners)

### Bolder Typography
- Left-aligned titles (moving away from centered large titles in some contexts)
- Increased font weight for titles and headings
- Stronger contrast between title and body text hierarchy

### Fluid Responsiveness
- UI elements morph and adapt during interactions
- Transitions feel liquid — smooth, continuous, organic
- Materials respond to user interaction (press causes ripple/depth change)

---

## Implementation

### Glass Material

```css
/* Liquid Glass base material */
.glass-material {
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--radius-xl);
}

/* Dark mode glass */
@media (prefers-color-scheme: dark) {
  .glass-material {
    background: rgba(30, 30, 30, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
}

/* Thicker glass for navigation bars and tab bars */
.glass-material-thick {
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(40px) saturate(200%);
  -webkit-backdrop-filter: blur(40px) saturate(200%);
}

/* Thin glass for cards and overlays */
.glass-material-thin {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px) saturate(150%);
  -webkit-backdrop-filter: blur(12px) saturate(150%);
}
```

### Dynamic Tinting

In Liquid Glass, materials pick up color from the content behind them. For web implementations, approximate this with:

```css
/* Tinted glass that adapts to a known background color */
.glass-tinted {
  background: color-mix(in srgb, var(--tint-color) 15%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}
```

In native SwiftUI, use `.ultraThinMaterial`, `.thinMaterial`, `.regularMaterial`, `.thickMaterial`, or `.ultraThickMaterial` — the system handles dynamic tinting automatically.

### Navigation Bar (Liquid Glass)

```css
.navbar-glass {
  position: sticky;
  top: 0;
  z-index: 100;
  padding: 0 16px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(40px) saturate(200%);
  -webkit-backdrop-filter: blur(40px) saturate(200%);
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.1);
}

@media (prefers-color-scheme: dark) {
  .navbar-glass {
    background: rgba(30, 30, 30, 0.6);
    border-bottom: 0.5px solid rgba(255, 255, 255, 0.05);
  }
}
```

### Tab Bar (Liquid Glass)

The iOS 26 tab bar features a floating pill-shaped design:

```css
.tabbar-glass {
  position: fixed;
  bottom: calc(16px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(40px) saturate(200%);
  -webkit-backdrop-filter: blur(40px) saturate(200%);
  border-radius: var(--radius-full);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.tabbar-glass-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-full);
  transition: all var(--duration-fast) var(--ease-spring);
}

.tabbar-glass-item.active {
  background: rgba(0, 122, 255, 0.15);
  color: var(--system-blue);
}
```

### Cards (Liquid Glass)

```css
.card-glass {
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(16px) saturate(160%);
  -webkit-backdrop-filter: blur(16px) saturate(160%);
  border-radius: var(--radius-lg);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: var(--space-4);
  transition: transform var(--duration-fast) var(--ease-spring);
}

.card-glass:active {
  transform: scale(0.98);
}

@media (prefers-color-scheme: dark) {
  .card-glass {
    background: rgba(40, 40, 40, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
}
```

---

## Interaction Effects

### Press Response
Liquid Glass elements respond to touch with a subtle depth change:

```css
.glass-interactive {
  transition: all var(--duration-instant) var(--ease-out);
}

.glass-interactive:active {
  transform: scale(0.97);
  filter: brightness(0.95);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); /* reduced shadow on press */
}

.glass-interactive:hover {
  filter: brightness(1.05);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12); /* elevated on hover */
}
```

### Morphing Transitions
Elements in Liquid Glass smoothly morph between states rather than cross-fading:

```css
/* Shared element transition (where supported) */
::view-transition-old(card),
::view-transition-new(card) {
  animation-duration: var(--duration-normal);
  animation-timing-function: var(--ease-spring);
}
```

---

## Fallbacks

Always provide solid-background fallbacks for:
- Browsers without `backdrop-filter` support
- Users with `prefers-reduced-transparency` enabled
- Performance-constrained devices

```css
/* Feature detection */
@supports not (backdrop-filter: blur(1px)) {
  .glass-material {
    background: var(--bg-secondary);
    border: 1px solid var(--separator);
  }
}

/* Respect reduced transparency preference */
@media (prefers-reduced-transparency: reduce) {
  .glass-material {
    background: var(--bg-secondary);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

---

## SwiftUI Implementation Notes

For native apps targeting iOS 26+:

```swift
// Glass material
.background(.ultraThinMaterial)
.background(.regularMaterial)

// Glass-style button
.buttonStyle(.glass)

// Tab bar automatically uses new floating glass style
TabView { ... }

// Glass group box
GroupBox { ... }
  .backgroundStyle(.glass)
```

The system automatically applies Liquid Glass to standard controls when the app is compiled with the iOS 26 SDK.

---

## When NOT to Use Liquid Glass

- Content-heavy reading views (articles, books) — solid backgrounds for readability
- Photo/video editing — glass effects compete with the content being edited
- Accessibility-sensitive contexts — some users find translucency disorienting
- Legacy platform targets (iOS 25 and earlier)
- Performance-critical views with many layered elements
