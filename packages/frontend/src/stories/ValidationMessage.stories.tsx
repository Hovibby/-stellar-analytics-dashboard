import type { Meta, StoryObj } from '@storybook/react';
import { ValidationMessage } from '@/components/ValidationMessage';

/**
 * ValidationMessage — inline error or hint shown below form fields.
 *
 * Pass either `error` (red, role="alert") or `hint` (muted info). If both are
 * supplied the error takes precedence.
 */
const meta = {
  title: 'Components/ValidationMessage',
  component: ValidationMessage,
  tags: ['autodocs'],
  argTypes: {
    error: { control: 'text' },
    hint: { control: 'text' },
    id: { control: 'text' },
  },
} satisfies Meta<typeof ValidationMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorState: Story = {
  args: {
    error: 'This field is required.',
  },
};

export const HintState: Story = {
  args: {
    hint: 'Account IDs start with G and are 56 characters long.',
  },
};

export const ErrorOverridesHint: Story = {
  name: 'Error takes precedence over hint',
  args: {
    error: 'Invalid account ID format.',
    hint: 'Should not be visible.',
  },
};

export const Empty: Story = {
  name: 'Renders nothing when empty',
  args: {},
  parameters: {
    docs: {
      description: {
        story: 'When neither `error` nor `hint` is provided the component renders null.',
      },
    },
  },
};
