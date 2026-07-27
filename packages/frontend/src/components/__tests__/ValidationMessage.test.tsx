import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ValidationMessage } from '../ValidationMessage';

describe('ValidationMessage', () => {
  it('renders nothing when no error or hint', () => {
    const { container } = render(<ValidationMessage />);
    expect(container.firstChild).toBeNull();
  });

  it('renders error message with alert role', () => {
    render(<ValidationMessage error="This field is required" />);
    const el = screen.getByRole('alert');
    expect(el).toHaveTextContent('This field is required');
  });

  it('renders hint message without alert role', () => {
    render(<ValidationMessage hint="Enter a valid Stellar address" />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Enter a valid Stellar address')).toBeInTheDocument();
  });

  it('prefers error over hint when both provided', () => {
    render(<ValidationMessage error="Bad input" hint="Some hint" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Bad input');
    expect(screen.queryByText('Some hint')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<ValidationMessage error="Oops" className="custom-class" />);
    expect(screen.getByRole('alert')).toHaveClass('custom-class');
  });

  it('sets id for aria-describedby linking', () => {
    render(<ValidationMessage error="Required" id="field-error" />);
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'field-error');
  });
});
