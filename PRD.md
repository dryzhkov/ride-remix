# Ride Remix · V1 PRD

## Goal

Help motorcycle riders build practice sessions, log how each drill felt, and use their history to decide what to practice next. Start with a mobile-first progressive web app (PWA) that works offline after initial setup.

## Core flow

Build a deck → practice one drill at a time → log and optionally rate each drill → review progress → build the next deck.

## V1 features

| Feature | What riders can do |
|---|---|
| Build and remix a deck | Choose available time, practice setup, and skill focus. Get a short deck from the drill library, then keep, swap, or reorder drills. |
| Create custom drills | Create a drill or copy and adapt a clinic drill. Save it for future decks. |
| Practice and rate | View one drill at a time with a short cue and setup details. Log **Still finding it**, **Getting consistent**, or **Repeatable today**. Ratings are optional. |
| Track history and progression | See recent sessions, how often each drill was practiced, and ratings across attempts. Show the setup alongside each attempt so riders can compare similar conditions. |
| Start the next ride | Build a fresh deck from History. Bring back a drill or move on to something new. |
| Invite to practice | Share just the deck link. A friend can preview it and save their own copy for offline practice. Each rider’s history and ratings stay private. |
| Work offline | After initial setup, build and remix decks, open drill guides, log practice, and review history in airplane mode. Save progress automatically on the device. Open and save shared decks while connected. |

## Drill library

Use the Olympia clinic material only to seed the initial drill database. The library can grow with new built-in drills and rider-created drills. Present the starter drills as a general practice library. Keep the clinic name and origin out of all rider-facing content, including shared decks.

## Scope

Three main screens are **Deck**, **Practice**, and **History**. Offline video, account sync, and competitive features are outside V1.

## Acceptance test

Share a deck and have a friend save it while connected. Both riders can reopen it in airplane mode and log their own practice. On the next ride, each rider can build a fresh deck offline, repeat a drill, and see both attempts in their own history.
