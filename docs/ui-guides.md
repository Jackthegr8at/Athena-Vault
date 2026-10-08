# In-app page guides

Athena Vault provides a shared help button on the primary workspace pages. Open it from the page header to see the purpose of the current page, a short set of recommended steps, a data-aware snapshot, and one next action based on the current workspace state.

On the first visit to a guide-enabled page, its guide opens automatically once for the authenticated owner. For regular workspaces, the seen state is stored server-side, so it follows the owner across browsers. The shared demo intentionally uses a browser-local first-visit marker so each browser can explore the guides independently; the help button remains available for manual reopening in both modes.

## Current coverage

| Workspace page | Route | Guide |
| --- | --- | --- |
| Overview | `/` | Available |
| Accounts | `/accounts` | Available |
| Cash flow | `/cash-flow` | Available |
| Recurring payments | `/cash-flow/recurring` | Available |
| Annual expenses | `/annual-expenses` | Available |
| Home | `/home` | Available |
| Salaries | `/salaries` | Available |
| Shared Expenses | `/shared-expenses` | Available |
| Shared expense workspace | `/shared-expenses/:id` | Available |
| Investments | `/investments` | Available — REEI/RDSP holdings and projection planning |
| Settings | `/settings` | Available |
| Goals | `/goals` | Planned follow-up |

Goals is a normal authenticated workspace page and is intentionally recorded as the remaining guide gap. Its empty state still provides a direct next action; it does not yet have the shared contextual help content and snapshot used by the other workspace modules.

The Investments guide covers both workflows on the page: add and value multiple FCP / MF and FNB / ETF positions inside an active REEI/RDSP Account, or create a separate calculator/portfolio projection. The holdings section is omitted when no active REEI/RDSP Account exists. The Symbol field offers debounced suggestions when the optional server-side EODHD search is configured, while manual entry remains available; supported Vanguard mutual-fund codes also use the local catalog. Holdings prices and USD conversion rates are dated readouts; an empty zero-unit position displays zero while missing data for a non-zero position remains unavailable.

Suggestions include a details action that opens the authenticated `/investments/instrument/:symbol` verification dashboard in a new tab with the selected type and currency. This specialized route is read-only, shows the resolved instrument and current quote when available, links to Vanguard Canada or Yahoo Finance, and can return a verified symbol to the add-position form. It intentionally has no separate page-help key because it is a verification step inside the Investments workflow.

## Special-purpose routes

The authentication and invitation routes (`/login`, `/setup`, and `/invite`) are onboarding flows rather than workspace modules. The public security page and the administrator-only invitation form are also specialized screens, so they do not use the workspace guide registry.

When a new authenticated workspace page is added, give it a page-help entry, a state-aware snapshot/action, focused coverage tests, and an entry in this table.

## Responsive layout and duplicate trees

Phase 7 collapsed the desktop/mobile duplicate trees on Accounts and the dashboard into single mounts recomposed with CSS. The two remaining routes that render distinct phone markup were reviewed under the same policy; both are recorded below with their decision.

| Route | Decision | Rationale |
| --- | --- | --- |
| `/home` | Accepted | The phone composition is a different interaction model, not a restyle. `HomeOverviewTop` mounts `home-overview-mobile` beside the desktop `home-overview-top`: the phone tree is a "Home pulse" card with an animated line canvas, a native `<details>` Cash Flow automation panel carrying its own `HouseholdCashFlowControls` mounts, and a snapshot card whose "Manage home details" link imperatively opens the `home-property-details` disclosure and scrolls to it. That link exists because the rest of the page is disclosure-driven on phones — `HomeMobileDisclosure`/`HomeMobileSubdisclosure` are single mounts that render as `display: contents` on desktop and become collapsible cards on phones. A single mount would have to force the always-visible desktop side cards into that disclosure navigation model, or re-platform the open-and-scroll link and `<details>` automation panel onto desktop semantics. |
| `/investments` | Accepted | `InvestmentProjectManager` mounts `MobileInvestmentWorkspace` alongside the desktop section; CSS hides whichever tree does not apply while the shared create/detail/edit/delete dialogs stay mounted outside the hidden region. The trees diverge in content, not only layout: desktop shows a metric strip, a nine-column projects table with row actions, a "How the numbers are calculated" toggle, and the `PlanningGuide` panel, none of which exist on phones; the phone tree instead shows a hero with a primary action, a four-card summary (including an Accounts count the desktop strip omits), tappable project cards with footer Edit/Delete, and a `<details>` explainer. Forcing one mount would either push the wide table onto phones or delete the desktop planning guide and table semantics — a semantic redesign, not a recomposition. |
