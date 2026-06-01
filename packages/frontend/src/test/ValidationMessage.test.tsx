import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ValidationMessage } from '../components/ValidationMessage';

describe('ValidationMessage', () => {
  it('renders nothing when no error or hint', () => {
    const { container } = render(<ValidationMessage />);
    expect(container.firstChild).toBeNull();
  });

  it('renders error with role=alert', () => {
    render(<ValidationMessage error="This field is required" />);
    const msg = screen.getByRole('alert');
    expect(msg).toHaveTextContent('This field is required');
  });

  it('renders hint without role=alert', () => {
    render(<ValidationMessage hint="Enter at least 2 characters" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Enter at least 2 characters')).toBeInTheDocument();
  });

  it('error takes precedence over hint', () => {
    render(<ValidationMessage error="Error!" hint="Hint" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Error!');
    expect(screen.queryByText('Hint')).not.toBeInTheDocument();
  });

  it('applies custom id for aria-describedby', () => {
    render(<ValidationMessage error="Bad input" id="field-error" />);
    expect(screen.getByRole('alert')).toHaveAttribute('id', 'field-error');
  });
});
