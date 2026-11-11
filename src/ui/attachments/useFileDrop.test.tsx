import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useFileDrop } from './useFileDrop';

function DropTarget({
  enabled,
  onFiles,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { dragging } = useFileDrop(ref, { enabled, onFiles });
  return (
    <div ref={ref} data-testid="drop">
      {dragging ? 'dragging' : 'idle'}
      <span>filho</span>
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
    render(<DropTarget enabled onFiles={vi.fn()} />);
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
    render(<DropTarget enabled onFiles={onFiles} />);
    const target = screen.getByTestId('drop');
    fireEvent.dragEnter(target, { dataTransfer: dataTransfer([file]) });
    fireEvent.drop(target, { dataTransfer: dataTransfer([file]) });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(target).toHaveTextContent('idle');
  });

  it('enabled=false e arrastar texto ignoram', () => {
    const onFiles = vi.fn();
    render(<DropTarget enabled={false} onFiles={onFiles} />);
    const target = screen.getByTestId('drop');
    fireEvent.dragEnter(target, { dataTransfer: dataTransfer() });
    expect(target).toHaveTextContent('idle');
    fireEvent.drop(target, { dataTransfer: dataTransfer([new File(['x'], 'a.png', { type: 'image/png' })]) });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it('arrastar texto sem Files ignora', () => {
    render(<DropTarget enabled onFiles={vi.fn()} />);
    const target = screen.getByTestId('drop');
    fireEvent.dragEnter(target, { dataTransfer: dataTransfer([], ['text/plain']) });
    expect(target).toHaveTextContent('idle');
  });
});
