<p align="center"><img src="docs/brand.svg" alt="photogram" width="620"></p>

Dump your camera roll in, get finished Instagram carousel slides back. I made this because every collage app I tried either stops at one image or wants money to place 20 photos.

Everything runs in your browser. Photos never leave your device.

[**Try it here.**](https://gitter499.github.io/ihavealotofphotostopostandphotocollagemakersarealleitherdumboraripoffsoclaudeismakingoneforme/)

![the app](docs/screen-desktop-9a381bbd.png)
![tilt and rounded corners](docs/screen-scrapbook-dc745741.png)
<img src="docs/screen-mobile-084b29ef.png" width="300" alt="on a phone">

## What it does

- Sorts photos by time and lays them out. No photo limit, no watermark.
- Slides break at natural time gaps. A standout shot gets a slide to itself.
- Spots burst duplicates so only the best one gets a big slot.
- Nudges similar colours onto the same slide.
- Filters with live preview bubbles, and an Off switch when they miss. The strip folds into a dot row when you're not choosing.
- A Remix button that regroups everything under a different idea each press: colour runs, light arcs, hero shots anchoring slides, lookalikes split apart.
- Tilt, rounded corners, gutter width, 4:5 or 1:1.
- Mesh mode: a photo can run across two slides, so the carousel swipes as one continuous strip.
- Drag photos between slides or within one. Add, delete, reorder slides. Set any slide's photo count.
- A playground shelf under the slides: park photos there while you experiment, drag them back when you're sure. Regroup and remix leave parked photos alone.
- Exports numbered 1440×1800 JPEGs in a zip, ready to post in order.

## Run it

```
npm install
npm run dev
```

Tests: `npm test` and `npm run test:e2e`.
