# Main menu and navigation

The menu is defined once in `src/lib/navigation.js` and rendered by one component for every viewport. No secrets or migrations are involved.

## Structure
`buildNavTree({ signedIn, isAdmin, moduleEnabled, threads, hasPayments })` returns the tree for the user's own context:

- Top level: **Rider Telemetry** (sub-items *My sessions* `/` and *Following* `/?scope=following`), **Personal Best Vault**, **Messages** (only when the user has conversations), **Payments** (only with a payment relationship).
- Collapsible groups: **Training**, **Lab** (`/lab/<key>`, keys in `LAB_MENU_KEYS`, labels from `labFeatures.js`), **Tools**, **Community** (Riders with *Find* / *Following*; Coach directory for logged-out visitors and coach-module users), **Coaching** (coach module only), **Admin** (admins only; `ADMIN_LINKS` in `src/lib/adminLinks.js`), **Settings**.
- Then **About** and **Feedback**.

`NAV_ITEMS` stays as the flat list used by the athlete-context sidebar (`sidebarItems` in `coachContext.js`), which is unchanged: inside `/coach/<riderId>/...` only athlete pages are shown and the bottom bar is hidden.

Settings entries point to `/settings` and `/connections` until the split settings routes exist; set `SETTINGS_SUBPAGES = true` in `navigation.js` to switch to the final hrefs.

## Messages list
`useNavThreads` (`src/components/useNavThreads.js`) fetches `chat_threads_summary` once (shared, deduplicated, refreshed on navigation) for the sidebar, drawer and bottom bar. The menu shows the 5 most recent conversations (`recentThreads`, newest message first) with unread counts and a *View all* link to `/chat`.

## Behaviour
- Active state, group auto-open and remembered open groups are pure helpers in `src/lib/navState.js` (open groups live in `localStorage` key `velocity:nav-open-groups`); the group holding the current page always opens.
- Query-aware items (`?scope=`, `?tab=`) are active by comparing the query with the item's defaults. `Dashboard` follows `?scope=` changes so the menu and the Feed tabs stay in sync.
- Logged-out visitors keep the locked-item behaviour (`isNavItemLocked`).
- Desktop (lg+): persistent sidebar with indented single-line sub-items. Below lg: the same tree in the drawer with 44px rows plus a fixed bottom bar (`BottomNav`: Home, Calendar, Messages, Menu) that respects safe-area insets. The bar is hidden for logged-out visitors and in athlete context.
