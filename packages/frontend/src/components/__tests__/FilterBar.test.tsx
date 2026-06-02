import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { FilterBar, FilterRow, ToggleGroup, RangeInput, DateRangeInput } from '../FilterBar';

describe('FilterBar', () => {
  it('renders toggle button', () => {
    render(<FilterBar activeCount={0} onReset={vi.fn()}><div>filters</div></FilterBar>);
    expect(screen.getByRole('button', { name: /expand filters/i })).toBeInTheDocument();
  });

  it('shows active count badge', () => {
    render(<FilterBar activeCount={3} onReset={vi.fn()}><div /></FilterBar>);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('expands and collapses on toggle', async () => {
    render(<FilterBar activeCount={0} onReset={vi.fn()}><div>filter content</div></FilterBar>);
    const btn = screen.getByRole('button', { name: /expand filters/i });
    await userEvent.click(btn);
    expect(screen.getByText('filter content')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /collapse filters/i }));
    expect(screen.queryByText('filter content')).not.toBeInTheDocument();
  });

  it('shows reset button when activeCount > 0', () => {
    render(<FilterBar activeCount={2} onReset={vi.fn()}><div /></FilterBar>);
    expect(screen.getByRole('button', { name: /reset all filters/i })).toBeInTheDocument();
  });

  it('calls onReset when reset clicked', async () => {
    const onReset = vi.fn();
    render(<FilterBar activeCount={1} onReset={onReset}><div /></FilterBar>);
    await userEvent.click(screen.getByRole('button', { name: /reset all filters/i }));
    expect(onReset).toHaveBeenCalled();
  });

  it('renders preset buttons', () => {
    const presets = [{ label: 'Last 24h', apply: vi.fn() }];
    render(<FilterBar activeCount={0} onReset={vi.fn()} presets={presets}><div /></FilterBar>);
    expect(screen.getByRole('button', { name: 'Last 24h' })).toBeInTheDocument();
  });

  it('calls preset.apply when preset clicked', async () => {
    const apply = vi.fn();
    render(
      <FilterBar activeCount={0} onReset={vi.fn()} presets={[{ label: 'Quick', apply }]}>
        <div />
      </FilterBar>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Quick' }));
    expect(apply).toHaveBeenCalled();
  });

  it('opens by default when defaultOpen=true', () => {
    render(<FilterBar activeCount={0} onReset={vi.fn()} defaultOpen><div>visible</div></FilterBar>);
    expect(screen.getByText('visible')).toBeInTheDocument();
  });
});

describe('FilterRow', () => {
  it('renders label and children', () => {
    render(<FilterRow label="Status"><span>child</span></FilterRow>);
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('child')).toBeInTheDocument();
  });
});

describe('ToggleGroup', () => {
  it('renders all options', () => {
    const opts = [{ label: 'All', value: undefined }, { label: 'Active', value: 'active' }];
    render(<ToggleGroup options={opts} value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('calls onChange with option value on click', async () => {
    const onChange = vi.fn();
    const opts = [{ label: 'Active', value: 'active' }];
    render(<ToggleGroup options={opts} value={undefined} onChange={onChange} />);
    await userEvent.click(screen.getByText('Active'));
    expect(onChange).toHaveBeenCalledWith('active');
  });
});

describe('RangeInput', () => {
  it('renders min and max inputs', () => {
    render(
      <RangeInput
        minValue="" maxValue=""
        onMinChange={vi.fn()} onMaxChange={vi.fn()}
        placeholder={{ min: 'Min', max: 'Max' }}
      />
    );
    expect(screen.getByPlaceholderText('Min')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Max')).toBeInTheDocument();
  });

  it('calls onMinChange on input', async () => {
    const onMinChange = vi.fn();
    render(
      <RangeInput minValue="" maxValue="" onMinChange={onMinChange} onMaxChange={vi.fn()} />
    );
    await userEvent.type(screen.getByPlaceholderText('Min'), '5');
    expect(onMinChange).toHaveBeenCalled();
  });

  it('shows minError', () => {
    render(
      <RangeInput minValue="" maxValue="" onMinChange={vi.fn()} onMaxChange={vi.fn()} minError="Too low" />
    );
    expect(screen.getByText('Too low')).toBeInTheDocument();
  });
});

describe('DateRangeInput', () => {
  it('renders two datetime inputs', () => {
    render(
      <DateRangeInput startValue="" endValue="" onStartChange={vi.fn()} onEndChange={vi.fn()} />
    );
    const inputs = screen.getAllByDisplayValue('');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('shows endError', () => {
    render(
      <DateRangeInput startValue="" endValue="" onStartChange={vi.fn()} onEndChange={vi.fn()} endError="End before start" />
    );
    expect(screen.getByText('End before start')).toBeInTheDocument();
  });
});
