# Main menu and navigation

The menu is defined once in `src/lib/navigation.js` and rendered by one component for every viewport. No secrets or migrations are involved.

## Structure
`buildNavTree({ signedIn, isAdmin, moduleEnabled, threads, hasPayments })` returns the tree for the user's own context:

- Top level, in order: **Rider Telemetry** (sub-items *My sessions* `/` and *Following* `/?scope=following`), **Training**, **Messages** (only when the user has conversations), **Personal Best Vault**, **Tools**, **Community**, **Coaching** (module enabled), **Lab**, **About**, **Feedback**, **Settings** (Payments lives inside it), **Admin** (admins only). Rider Telemetry and Messages are collapsible. Hidden items (Messages, Coaching, Admin) do not change the relative order.
- Collapsible groups: **Training**, **Lab** (`/lab/<key>`, keys in `LAB_MENU_KEYS`, labels from `labFeatures.js`), **Tools**, **Community** (Riders with *Find* / *Following*; Coach directory for logged-out visitors and coach-module users), **Coaching** (coach module only), **Admin** (admins only; `ADMIN_LINKS` in `src/lib/adminLinks.js`), **Settings**.
- Then **About** and **Feedback**.

Inside `/coach/<riderId>/...` the same menu component renders `buildAthleteTree` (`coachContext.js`): a **Viewing <name>** group (Overview, Activities, Calendar, Fitness, Personal Bests, Templates, Physiology, **Lab** with its features as sub-items, Notes with the coach module), **Messages** and **Coach dashboard**. The coach's own pages are hidden. The athlete tab bar and the Lab feature strip are gone; the layout keeps the access check and the "Coaching: <Name> - Exit" banner. The bottom bar shows Overview, Activities, Calendar and Menu for that athlete.

Settings is split into pages: **Profile** `/settings`, **Preferences** `/settings/preferences`, **Gear and defaults** `/settings/gear`, **Physiology** `/settings/physiology`, **Connections** `/connections`, **Privacy** `/settings/privacy`, **Coaching** `/settings/coaching` (the coach card stays at `/settings/coach-card`). Each page shows a `Settings › <Page>` breadcrumb (`SettingsShell`). Pages that edit profile fields (Profile, Preferences, Gear) have their own form and Save button and save only their own columns (`buildProfileUpdate` in `src/lib/settingsProfile.js`, used by `useSettingsProfile`), so one page can never overwrite another page's values. Old `/settings#coaching`, `#onboarding` and `#physiology` links redirect to the new pages (`legacySettingsRedirect`).

## Messages list
`useNavThreads` (`src/components/useNavThreads.js`) fetches `chat_threads_summary` once (shared, deduplicated, refreshed on navigation) for the sidebar, drawer and bottom bar. The menu shows the 5 most recent conversations (`recentThreads`, newest message first) with unread counts and a *View all* link to `/chat`.

## Behaviour
- Active state, group auto-open and the remembered open group are pure helpers in `src/lib/navState.js` (open groups live in `localStorage` key `velocity:nav-open-groups`); the group holding the current page always opens (closing the others) and clicking the open group's header collapses it. Rider Telemetry and Messages are accordion sections too: the label navigates (and opens the section), the chevron toggles it, and the Messages unread badge stays on the header. Only top-level entries and group headers have icons; every child is a smaller icon-less row (`pl-11`, nested items `pl-16`, 44px rows on touch).
- Query-aware items (`?scope=`, `?tab=`) are active by comparing the query with the item's defaults. `Dashboard` follows `?scope=` changes so the menu and the Feed tabs stay in sync.
- Logged-out visitors keep the locked-item behaviour (`isNavItemLocked`).
- Desktop (lg+): persistent sidebar with indented single-line sub-items. Below lg: the same tree in the drawer with 44px rows plus a fixed bottom bar (`BottomNav`: Home, Calendar, Messages, Menu) that respects safe-area insets. The bar is hidden for logged-out visitors.

## Sections live in the menu, not in the page
- Lab features, Admin pages, Riders (*Find* / *Following*) and Templates (*Public* / *Mine* / *Favorites* / *System*, `?tab=`) are menu entries; the in-page tab strips and the admin pill bar are gone. `ADMIN_LINKS` stays the shared source for the Admin group.
- `PageBreadcrumb` (`src/components/PageBreadcrumb.js`) shows the trail ("Lab › Durability", "Admin › Chat reports", "Riders › Following"). `breadcrumbTrail(tree, pathname, search)` in `navState.js` derives it from the menu tree; the admin layout uses `PathBreadcrumb`.
- `/templates` and `/riders` read `?tab=`; `/templates` writes the default (`mine` signed in, `public` visitors) into the URL so the menu highlights it.
- No page repeats navigation the menu or breadcrumb already gives. The breadcrumb is the first element above the title (`AdminPage` takes a `crumbs` prop; settings, templates and riders place it above their H1) and replaces "All lab tools", "Admin dashboard", "All suggestions", "Settings" and "Home" back links; parents are links, the current page is plain text. Top-level pages without a trail (Messages list, Coach dashboard, PB Vault, Calendar, Fitness) show none. `LabShell` has no feature strip. Chat threads show "Messages › name".
- **Payments** is a child of Settings (only with a payment relationship), not a top-level item.

## Tabs and view switches
In-page view switches (Velodromes Cards/Table, Power unit W / W/kg, Admin period and filters, Fitness forecast horizon and chart range, template run chart values) all use `src/components/SegmentedTabs.js`: orange pill, `role="tablist"`, roving tabindex with arrow/Home/End keys, 44px tabs below `sm`, wrapping on narrow screens. Navigation between pages is never a tab strip; it belongs in the menu. The vertical feature picker of `LoginFeaturesModal` (dark glass modal) is intentionally left as is.
