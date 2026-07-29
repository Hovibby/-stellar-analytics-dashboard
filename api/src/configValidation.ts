// Issue #178: Environment-specific configuration validation
// Fails fast when required environment variables are missing or invalid

interface EnvValidationRule {
  name: string;
  required: boolean;
  validator?: (value: string) => boolean;
  errorMessage?: string;
}

const VALIDATION_RULES: EnvValidationRule[] = [
  { name: 'DATABASE_URL', required: true },
  { name: 'REDIS_URL', required: true },
  { name: 'JWT_SECRET', required: true, validator: (v) => v.length >= 32, errorMessage: 'must be at least 32 characters' },
  { name: 'STELLAR_NETWORK', required: true, validator: (v) => ['testnet', 'mainnet', 'futurenet'].includes(v), errorMessage: 'must be testnet, mainnet, or futurenet' },
  { name: 'HORIZON_URL', required: true },
  { name: 'SOROBAN_RPC_URL', required: true },
  { name: 'PORT', required: false, validator: (v) => !isNaN(Number(v)) && Number(v) > 0, errorMessage: 'must be a positive number' },
];

const PRODUCTION_ONLY_RULES: EnvValidationRule[] = [
  { name: 'SENTRY_DSN', required: true },
  { name: 'CORS_ORIGIN', required: true },
];

export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];
  const isProduction = env.NODE_ENV === 'production';
  const rules = isProduction ? [...VALIDATION_RULES, ...PRODUCTION_ONLY_RULES] : VALIDATION_RULES;

  for (const rule of rules) {
    const value = env[rule.name];
    if (rule.required && (!value || value.trim() === '')) {
      errors.push(`${rule.name} is required but not set`);
      continue;
    }
    if (value && rule.validator && !rule.validator(value)) {
      errors.push(`${rule.name}: ${rule.errorMessage || 'invalid value'}`);
    }
  }

  return errors;
}

export function assertValidEnvironment(): void {
  const errors = validateEnvironment();
  if (errors.length > 0) {
    console.error('Configuration validation failed:');
    errors.forEach(e => console.error(`  ✗ ${e}`));
    console.error('\nSet the missing variables in your .env file or environment.');
    process.exit(1);
  }
  console.log('✓ Environment configuration validated');
}
