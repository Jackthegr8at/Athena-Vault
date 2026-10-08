import React, { type CSSProperties, type DragEvent, type ReactNode } from "react";
import { formatMoneyMinor } from "../../lib/format-money";
import { formatTimelineDelta, maskedAccountLastFour, type AccountsPresentation, type TimelineAccountPresentation, type TimelineCellPresentation, type TimelineColumnPresentation, type TimelineDeltaPresentation, type TimelineGroupPresentation } from "./presentation";

export function TimelineDeltaBadge({ delta }: { readonly delta: TimelineDeltaPresentation | null }) {
  if (!delta) return null;
  return <span className={`timeline-cell-delta is-${delta.tone}`}>{formatTimelineDelta(delta.deltaMinor)}</span>;
}

export interface TimelineCellRenderInput {
  readonly account: TimelineAccountPresentation;
  readonly column: TimelineColumnPresentation;
  readonly cell: TimelineCellPresentation;
  readonly columnIndex: number;
}

export function AccountTimelineTable({
  presentation,
  tableStyle,
  isEditing,
  renderCell,
}: {
  readonly presentation: AccountsPresentation;
  readonly tableStyle: CSSProperties;
  readonly isEditing: (account: TimelineAccountPresentation, column: TimelineColumnPresentation) => boolean;
  readonly renderCell: (input: TimelineCellRenderInput) => ReactNode;
}) {
  if (presentation.columns.length === 0) return <div className="account-empty">No payday columns are available yet.</div>;
  return <div className="account-timeline-viewport">
    <table className="account-timeline-table is-fluid" style={tableStyle}>
      <caption className="sr-only">Editable account balances by biweekly payday</caption>
      <thead><tr>
        <th className="timeline-account-column" scope="col">Account</th>
        {presentation.columns.map((column) => <th className={`timeline-date-column${column.selected ? " is-selected" : ""}`} scope="col" key={column.date}>
          <span>{column.shortLabel}</span>
          <small className={`timeline-column-state is-${column.state}`}>{column.stateLabel}</small>
        </th>)}
      </tr></thead>
      <tbody>{presentation.groups.map((group) => <React.Fragment key={group.key}>
        <tr className="timeline-group-row" key={`${group.key}-heading`}>
          <th className="timeline-account-column" scope="rowgroup"><span>{group.label}</span><small>{group.accounts.length} {group.accounts.length === 1 ? "account" : "accounts"}</small></th>
          <td className="timeline-group-fill" colSpan={presentation.columns.length} aria-hidden="true"></td>
        </tr>
        {group.accounts.map((account) => <tr className={!account.isActive ? "timeline-archived-row" : undefined} key={account.id}>
          <th className="timeline-account-column timeline-account-row" scope="row">
            <span className="timeline-account-name">{account.name}</span>
            <span className="timeline-account-meta">{account.institution} · {account.kindLabel}</span>
            {maskedAccountLastFour(account.lastFour) ? <span className="timeline-account-last-four">{maskedAccountLastFour(account.lastFour)}</span> : null}
            {!account.isActive ? <span className="account-status-badge is-archived">Archived</span> : null}
          </th>
          {account.cells.map((cell, columnIndex) => {
            const column = presentation.columns[columnIndex];
            if (!column) return null;
            const editing = isEditing(account, column);
            return <td className={`timeline-balance-cell${column.selected ? " is-selected" : ""}${editing ? " is-editing" : ""}`} key={column.date}>
              {renderCell({ account, column, cell, columnIndex })}
            </td>;
          })}
        </tr>)}
        <tr className="timeline-total-row" key={`${group.key}-total`}>
          <th className="timeline-account-column" scope="row">{group.label} total</th>
          {group.totals.map((total, index) => <td className={presentation.columns[index]?.selected ? "is-selected" : undefined} key={presentation.columns[index]?.date}>
            <div className="timeline-total-cell">
              <TimelineDeltaBadge delta={group.totalDeltas[index] ?? null} />
              <span className="timeline-total-value">{formatMoneyMinor(total, { unavailableLabel: "—" })}</span>
            </div>
          </td>)}
        </tr>
      </React.Fragment>)}</tbody>
    </table>
  </div>;
}

export function AccountReorderRows({
  group,
  accountIds,
  draggedId,
  pending,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
}: {
  readonly group: TimelineGroupPresentation;
  readonly accountIds: readonly string[];
  readonly draggedId: string | null;
  readonly pending: boolean;
  readonly onDragStart: (accountId: string, event: DragEvent<HTMLLIElement>) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent<HTMLLIElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLLIElement>, targetId: string) => void;
  readonly onMove: (accountId: string, offset: -1 | 1) => void;
}) {
  const accountById = new Map(group.accounts.map((account) => [account.id, account]));
  return accountIds.length > 0 ? <ol className="timeline-order-list" aria-label={`${group.label} account order`}>
    {accountIds.map((accountId, index) => {
      const account = accountById.get(accountId);
      if (!account) return null;
      return <li
        className={`timeline-order-item${draggedId === account.id ? " is-dragged" : ""}`}
        draggable={!pending}
        key={account.id}
        onDragStart={(event) => onDragStart(account.id, event)}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDrop={(event) => onDrop(event, account.id)}
      >
        <span className="timeline-order-grip" aria-hidden="true">⋮⋮</span>
        <span className="timeline-order-name"><strong>{account.name}</strong><small>{account.institution}</small></span>
        <button className="account-secondary-button timeline-order-button" type="button" onClick={() => onMove(account.id, -1)} disabled={pending || index === 0} aria-label={`Move ${account.name} up within ${group.label}`}>Move up</button>
        <button className="account-secondary-button timeline-order-button" type="button" onClick={() => onMove(account.id, 1)} disabled={pending || index === accountIds.length - 1} aria-label={`Move ${account.name} down within ${group.label}`}>Move down</button>
      </li>;
    })}
  </ol> : <p className="timeline-order-empty">No accounts in this section.</p>;
}
