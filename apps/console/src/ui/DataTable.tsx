import type { ReactNode } from 'react';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'start' | 'end';
};

/** `<table>` semântica. As linhas levam `role="row"` explícito para seletores de teste por papel. */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: ReactNode;
  caption?: string;
}) {
  if (rows.length === 0) return <>{empty}</>;
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === 'end' ? 'is-end' : undefined}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} role="row">
              {columns.map((column) => (
                <td key={column.key} className={column.align === 'end' ? 'is-end' : undefined}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
