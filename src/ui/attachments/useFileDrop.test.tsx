import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useFileDrop } from './useFileDrop';

function DropHarness({
  enabled,
  onFiles,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const { dragging } = useFileDrop(zone, { enabled, onFiles, surface });
  return (
    <div>
      <div ref={surface} data-testid="surface">
        <div ref={zone} data-testid="drop">
          {dragging ? 'dragging' : 'idle'}
          <span>filho</span>
        </div>
        <aside data-testid="sidebar">fora da zona</aside>
      </div>
      <div data-testid="host">portal hospedeiro</div>
    </div>
  );
}

function dataTransfer(files: File[] = [], types: string[] = ['Files']) {
  return {
    types,
    files,
  };
}

describe('useFileDrop', () => {
  it('dragenter com Files liga dragging e filhos não desligam', () => {
    render(<DropHarness enabled onFiles={vi.fn()} />);
    const target = screen.getByTestId('drop');
    fireEvent.dragEnter(target, { dataTransfer: dataTransfer() });
    expect(target).toHaveTextContent('dragging');
    fireEvent.dragEnter(screen.getByText('filho'), { dataTransfer: dataTransfer() });
    expect(target).toHaveTextContent('dragging');
    fireEvent.dragLeave(screen.getByText('filho'), { dataTransfer: dataTransfer() });
    expect(target).toHaveTextContent('dragging');
    fireEvent.dragLeave(target, { dataTransfer: dataTransfer() });
    expect(target).toHaveTextContent('idle');
  });

  it('drop chama onFiles e desliga', () => {
    const onFiles = vi.fn();
    const file = new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' });
    render(<DropHarness enabled onFiles={onFiles} />);
    const target = screen.getByTestId('drop');
    fireEvent.dragEnter(target, { dataTransfer: dataTransfer([file]) });
    fireEvent.drop(target, { dataTransfer: dataTransfer([file]) });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(target).toHaveTextContent('idle');
  });

  it('enabled=false e arrastar texto ignoram', () => {
    const onFiles = vi.fn();
    render(<DropHarness enabled={false} onFiles={onFiles} />);
    const target = screen.getByTestId('drop');
    fireEvent.dragEnter(target, { dataTransfer: dataTransfer() });
    expect(target).toHaveTextContent('idle');
    fireEvent.drop(target, { dataTransfer: dataTransfer([new File(['x'], 'a.png', { type: 'image/png' })]) });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('arrastar texto sem Files ignora', () => {
    render(<DropHarness enabled onFiles={vi.fn()} />);
    const target = screen.getByTestId('drop');
    fireEvent.dragEnter(target, { dataTransfer: dataTransfer([], ['text/plain']) });
    expect(target).toHaveTextContent('idle');
  });

  it('soltar arquivo fora da zona, dentro da superfície, impede a navegação e não aceita', () => {
    const onFiles = vi.fn();
    render(<DropHarness enabled onFiles={onFiles} />);
    const prevented = dispatchFileDrag(screen.getByTestId('sidebar'));
    expect(prevented).toEqual({ over: true, drop: true });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('com a zona desligada ainda bloqueia o drop na superfície', () => {
    const onFiles = vi.fn();
    render(<DropHarness enabled={false} onFiles={onFiles} />);
    const prevented = dispatchFileDrag(screen.getByTestId('drop'));
    expect(prevented).toEqual({ over: true, drop: true });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('não intercepta drop fora da superfície do chat', () => {
    const onFiles = vi.fn();
    render(<DropHarness enabled onFiles={onFiles} />);
    expect(dispatchFileDrag(screen.getByTestId('host'))).toEqual({ over: false, drop: false });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('depois de desmontar não intercepta drop fora do chat', () => {
    const onFiles = vi.fn();
    const { unmount } = render(<DropHarness enabled onFiles={onFiles} />);
    unmount();
    const host = document.createElement('div');
    document.body.append(host);
    expect(dispatchFileDrag(host)).toEqual({ over: false, drop: false });
    host.remove();
    expect(fireEvent.dragOver(window, { dataTransfer: dataTransfer() })).toBe(true);
    expect(fireEvent.drop(window, { dataTransfer: dataTransfer() })).toBe(true);
  });
});

function dispatchFileDrag(node: Element): { over: boolean; drop: boolean } {
  const transfer = dataTransfer([new File([new Uint8Array([1])], 'foto.png', { type: 'image/png' })]);
  const over = new Event('dragover', { bubbles: true, cancelable: true });
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(over, 'dataTransfer', { value: transfer });
  Object.defineProperty(drop, 'dataTransfer', { value: transfer });
  node.dispatchEvent(over);
  node.dispatchEvent(drop);
  return { over: over.defaultPrevented, drop: drop.defaultPrevented };
}
