# Main menu and navigation

The menu is defined once in `src/lib/navigation.js` and rendered by one component for every viewport. No secrets or migrations are involved.

## Structure
`buildNavTree({ signedIn, isAdmin, moduleEnabled, threads, hasPayments })` returns the tree for the user's own context:

- Top level: **Rider Telemetry** (sub-items *My sessions* `/` and *Following* `/?scope=following`), **Personal Best Vault**, **Messages** (only when the user has conversations), **Payments** (only with a payment relationship).
- Collapsible groups: **Training**, **Lab** (`/lab/<key>`, keys in `LAB_MENU_KEYS`, labels from `labFeatures.js`), **Tools**, **Community** (Riders with *Find* / *Following*; Coach directory for logged-out visitors and coach-module users), **Coaching** (coach module only), **Admin** (admins only; `ADMIN_LINKS` in `src/lib/adminLinks.js`), **Settings**.
- Then **About** and **Feedback**.

`NAV_ITEMS` stays as the flat list used by the athlete-context sidebar (`sidebarItems` in `coachContext.js`), which is unchanged: inside `/coach/<riderId>/...` only athlete pages are shown and the bottom bar is hidden.

Settings is split into pages: **Profile** `/settings`, **Preferences** `/settings/preferences`, **Gear and defaults** `/settings/gear`, **Physiology** `/settings/physiology`, **Connections** `/connections`, **Privacy** `/settings/privacy`, **Coaching** `/settings/coaching` (the coach card stays at `/settings/coach-card`). Each page shows a `Settings › <Page>` breadcrumb (`SettingsShell`). Pages that edit profile fields (Profile, Preferences, Gear) have their own form and Save button and save only their own columns (`buildProfileUpdate` in `src/lib/settingsProfile.js`, used by `useSettingsProfile`), so one page can never overwrite another page's values. Old `/settings#coaching`, `#onboarding` and `#physiology` links redirect to the new pages (`legacySettingsRedirect`).

## Messages list
`useNavThreads` (`src/components/useNavThreads.js`) fetches `chat_threads_summary` once (shared, deduplicated, refreshed on navigation) for the sidebar, drawer and bottom bar. The menu shows the 5 most recent conversations (`recentThreads`, newest message first) with unread counts and a *View all* link to `/chat`.

## Behaviour
- Active state, group auto-open and remembered open groups are pure helpers in `src/lib/navState.js` (open groups live in `localStorage` key `velocity:nav-open-groups`); the group holding the current page always opens.
- Query-aware items (`?scope=`, `?tab=`) are active by comparing the query with the item's defaults. `Dashboard` follows `?scope=` changes so the menu and the Feed tabs stay in sync.
- Logged-out visitors keep the locked-item behaviour (`isNavItemLocked`).
- Desktop (lg+): persistent sidebar with indented single-line sub-items. Below lg: the same tree in the drawer with 44px rows plus a fixed bottom bar (`BottomNav`: Home, Calendar, Messages, Menu) that respects safe-area insets. The bar is hidden for logged-out visitors and in athlete context.

## Sections live in the menu, not in the page
- Lab features, Admin pages, Riders (*Find* / *Following*) and Templates (*Public* / *Mine* / *Favorites* / *System*, `?tab=`) are menu entries; the in-page tab strips and the admin pill bar are gone. `ADMIN_LINKS` stays the shared source for the Admin group.
- `PageBreadcrumb` (`src/components/PageBreadcrumb.js`) shows the trail ("Lab › Durability", "Admin › Chat reports", "Riders › Following"). `breadcrumbTrail(tree, pathname, search)` in `navState.js` derives it from the menu tree; the admin layout uses `PathBreadcrumb`.
- `/templates` and `/riders` read `?tab=`; `/templates` writes the default (`mine` signed in, `public` visitors) into the URL so the menu highlights it.
- `LabShell` keeps its feature strip only in athlete context (`riderId`, `/coach/<id>/lab`) until the athlete bar replaces it.
