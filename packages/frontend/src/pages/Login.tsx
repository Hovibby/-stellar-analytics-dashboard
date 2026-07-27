/**
 * Login Page
 *
 * Authentication page with client-side form validation.
 * Issue #124 – Add proper client-side validation with error messages.
 *
 * Uses React Hook Form + Zod for field-level validation with
 * accessible, inline error messages.
 */

import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/store';
import toast from 'react-hot-toast';

// ── Validation schema ─────────────────────────────────────────────────────────

/**
 * Zod schema for the login form.
 * Mirrors the server-side LoginInputSchema so errors are caught early.
 */
const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .min(1, 'Email is required')
    .email('Please enter a valid email address')
    .max(254, 'Email must be at most 254 characters'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required')
    .max(128, 'Password must be at most 128 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ── Component ─────────────────────────────────────────────────────────────────

export function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched', // validate on blur, then on every change after first touch
  });

  const onSubmit = async (data: LoginFormValues) => {
    setServerError('');
    try {
      await login(data.email, data.password);
      toast.success('Login successful!');
      navigate('/');
    } catch (err) {
      setServerError('Invalid email or password. Please try again.');
      toast.error('Login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary rounded-2xl mb-4">
            <LogIn className="w-8 h-8 text-primary-foreground" aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Welcome Back</h1>
          <p className="text-muted-foreground">Sign in to access Stellar Analytics Dashboard</p>
        </div>

        <div className="bg-card border rounded-2xl p-8 shadow-lg">
          {/* Server-level error banner */}
          {serverError && (
            <div
              role="alert"
              aria-live="assertive"
              className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3"
            >
              <AlertCircle
                className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <p className="text-sm text-destructive">{serverError}</p>
            </div>
          )}

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-6"
            noValidate
            aria-label="Sign in form"
          >
            {/* Email field */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email{' '}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                aria-required="true"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
                className={`w-full px-4 py-3 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${
                  errors.email ? 'border-destructive focus:ring-destructive' : 'border-input'
                }`}
                placeholder="you@example.com"
              />
              {errors.email && (
                <p
                  id="email-error"
                  role="alert"
                  className="mt-1.5 text-sm text-destructive flex items-center gap-1"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password field */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                Password{' '}
                <span className="text-destructive" aria-hidden="true">
                  *
                </span>
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-required="true"
                  aria-invalid={!!errors.password}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                  className={`w-full px-4 py-3 pr-12 bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all ${
                    errors.password ? 'border-destructive focus:ring-destructive' : 'border-input'
                  }`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p
                  id="password-error"
                  role="alert"
                  className="mt-1.5 text-sm text-destructive flex items-center gap-1"
                >
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                  {errors.password.message}
                </p>
              )}
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div
                    className="w-5 h-5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                  />
                  Signing in...
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5" aria-hidden="true" />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link to="/register" className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
