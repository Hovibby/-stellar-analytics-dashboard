import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth';

// Mock external dependencies
jest.mock('jsonwebtoken');
jest.mock('bcryptjs');

const mockJwt = jwt as jest.Mocked<typeof jwt>;
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

const mockUser = {
  id: 'user-001',
  email: 'test@stellar-analytics.dev',
  name: 'Test User',
  role: 'user' as const,
  createdAt: '2024-01-01T00:00:00Z',
};

describe('AuthService', () => {
  let authService: AuthService;
  const TEST_SECRET = 'test-secret-32-chars-minimum!!';

  beforeEach(() => {
    jest.clearAllMocks();
    authService = new AuthService(TEST_SECRET);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────────────────
  describe('constructor', () => {
    it('should use provided JWT secret', () => {
      const svc = new AuthService('custom-secret');
      // Verify by generating token and checking sign was called with custom secret
      mockJwt.sign.mockReturnValue('token' as any);
      svc.generateToken(mockUser);
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-001' }),
        'custom-secret',
        expect.any(Object)
      );
    });

    it('should fall back to JWT_SECRET env var when no secret provided', () => {
      process.env.JWT_SECRET = 'env-secret-32-chars-long!';
      const svc = new AuthService();
      mockJwt.sign.mockReturnValue('token' as any);
      svc.generateToken(mockUser);
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.any(Object),
        'env-secret-32-chars-long!',
        expect.any(Object)
      );
      delete process.env.JWT_SECRET;
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // extractToken — unauthenticated / malformed header edge cases
  // ──────────────────────────────────────────────────────────────────────
  describe('extractToken', () => {
    it('should return null when authorization header is missing (unauthenticated)', () => {
      expect(authService.extractToken(undefined)).toBeNull();
    });

    it('should return null when authorization header is empty string', () => {
      expect(authService.extractToken('')).toBeNull();
    });

    it('should return null when authorization header is whitespace only', () => {
      expect(authService.extractToken('   ')).toBeNull();
    });

    it('should return null for non-Bearer authorization type', () => {
      expect(authService.extractToken('Basic dXNlcjpwYXNz')).toBeNull();
    });

    it('should return null when Bearer prefix is present but token is missing', () => {
      expect(authService.extractToken('Bearer')).toBeNull();
      expect(authService.extractToken('Bearer ')).toBeNull();
    });

    it('should return null for malformed authorization with too many parts', () => {
      expect(authService.extractToken('Bearer token extra')).toBeNull();
    });

    it('should extract token correctly from well-formed Bearer header', () => {
      expect(authService.extractToken('Bearer valid.jwt.token')).toBe('valid.jwt.token');
    });

    it('should extract token with Bearer in mixed case', () => {
      // Implementation is case-sensitive for 'Bearer' — verify behavior
      expect(authService.extractToken('bearer valid.jwt.token')).toBeNull();
      expect(authService.extractToken('BEARER valid.jwt.token')).toBeNull();
    });

    it('should handle extremely long token strings', () => {
      const longToken = 'a'.repeat(5000);
      expect(authService.extractToken(`Bearer ${longToken}`)).toBe(longToken);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // generateToken — JWT creation
  // ──────────────────────────────────────────────────────────────────────
  describe('generateToken', () => {
    it('should call jwt.sign with correct payload for admin user', () => {
      mockJwt.sign.mockReturnValue('admin-token' as any);
      const adminUser = { ...mockUser, role: 'admin' as const };
      const token = authService.generateToken(adminUser);

      expect(token).toBe('admin-token');
      expect(mockJwt.sign).toHaveBeenCalledWith(
        {
          userId: 'user-001',
          email: 'test@stellar-analytics.dev',
          role: 'admin',
        },
        TEST_SECRET,
        { expiresIn: '24h' }
      );
    });

    it('should call jwt.sign with correct payload for viewer user', () => {
      mockJwt.sign.mockReturnValue('viewer-token' as any);
      const viewerUser = { ...mockUser, role: 'viewer' as const };
      const token = authService.generateToken(viewerUser);

      expect(token).toBe('viewer-token');
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'viewer' }),
        TEST_SECRET,
        { expiresIn: '24h' }
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // verifyToken — stale / expired / invalid token edge cases
  // ──────────────────────────────────────────────────────────────────────
  describe('verifyToken', () => {
    it('should return payload for a valid token', () => {
      const validPayload = { userId: 'user-001', email: 'test@dev', role: 'user' as const };
      mockJwt.verify.mockReturnValue(validPayload as any);

      const result = authService.verifyToken('valid.token.here');
      expect(result).toEqual(validPayload);
    });

    it('should return null for an expired token (stale auth)', () => {
      mockJwt.verify.mockImplementation(() => {
        const err = new jwt.TokenExpiredError('jwt expired', new Date());
        throw err;
      });

      const result = authService.verifyToken('expired.token.here');
      expect(result).toBeNull();
    });

    it('should return null for a token with invalid signature (tampered)', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.JsonWebTokenError('invalid signature');
      });

      const result = authService.verifyToken('tampered.token.here');
      expect(result).toBeNull();
    });

    it('should return null for a malformed token', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.JsonWebTokenError('jwt malformed');
      });

      const result = authService.verifyToken('not-a-jwt');
      expect(result).toBeNull();
    });

    it('should return null for an empty string token', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.JsonWebTokenError('jwt must be provided');
      });

      const result = authService.verifyToken('');
      expect(result).toBeNull();
    });

    it('should return null for a token signed with wrong secret', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.JsonWebTokenError('invalid signature');
      });

      const result = authService.verifyToken('token-signed-with-different-secret');
      expect(result).toBeNull();
    });

    it('should return null for a NotBeforeError token', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new jwt.NotBeforeError('jwt not active', new Date(Date.now() + 3600000));
      });

      const result = authService.verifyToken('premature.token.here');
      expect(result).toBeNull();
    });

    it('should return null when jwt.verify throws a generic Error', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('some unexpected error');
      });

      const result = authService.verifyToken('problematic.token');
      expect(result).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // generateApiKey + validateApiKey
  // ──────────────────────────────────────────────────────────────────────
  describe('generateApiKey', () => {
    it('should generate a key with the correct prefix', () => {
      const apiKey = authService.generateApiKey();
      expect(apiKey).toMatch(/^sad_[0-9a-f]{64}$/);
    });

    it('should generate unique keys on each call', () => {
      const key1 = authService.generateApiKey();
      const key2 = authService.generateApiKey();
      expect(key1).not.toBe(key2);
    });
  });

  describe('validateApiKey', () => {
    it('should return true for a valid API key', () => {
      const apiKey = authService.generateApiKey();
      expect(authService.validateApiKey(apiKey)).toBe(true);
    });

    it('should return false for a key without the correct prefix', () => {
      expect(authService.validateApiKey('bad_1234567890abcdef1234567890abcdef')).toBe(false);
    });

    it('should return false for an empty string', () => {
      expect(authService.validateApiKey('')).toBe(false);
    });

    it('should return false for a key that is only the prefix', () => {
      expect(authService.validateApiKey('sad_')).toBe(false);
    });

    it('should return false for a null/undefined key (type coercion edge case)', () => {
      // @ts-expect-error Testing runtime behavior with invalid input
      expect(authService.validateApiKey(null)).toBe(false);
      // @ts-expect-error Testing runtime behavior with invalid input
      expect(authService.validateApiKey(undefined)).toBe(false);
    });

    it('should return false for a key with wrong case prefix', () => {
      expect(authService.validateApiKey('SAD_abcdef1234567890')).toBe(false);
    });

    it('should validate keys generated by a different AuthService instance with same secret', () => {
      const svc1 = new AuthService(TEST_SECRET);
      const svc2 = new AuthService(TEST_SECRET);
      const key = svc1.generateApiKey();
      expect(svc2.validateApiKey(key)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // hasPermission — role hierarchy for partial result access
  // ──────────────────────────────────────────────────────────────────────
  describe('hasPermission', () => {
    it('should grant admin access to admin-level resources', () => {
      expect(authService.hasPermission('admin', 'admin')).toBe(true);
    });

    it('should grant admin access to user-level resources', () => {
      expect(authService.hasPermission('admin', 'user')).toBe(true);
    });

    it('should grant admin access to viewer-level resources', () => {
      expect(authService.hasPermission('admin', 'viewer')).toBe(true);
    });

    it('should deny user access to admin-level resources', () => {
      expect(authService.hasPermission('user', 'admin')).toBe(false);
    });

    it('should grant user access to user-level resources', () => {
      expect(authService.hasPermission('user', 'user')).toBe(true);
    });

    it('should grant user access to viewer-level resources', () => {
      expect(authService.hasPermission('user', 'viewer')).toBe(true);
    });

    it('should deny viewer access to admin-level resources', () => {
      expect(authService.hasPermission('viewer', 'admin')).toBe(false);
    });

    it('should deny viewer access to user-level resources', () => {
      expect(authService.hasPermission('viewer', 'user')).toBe(false);
    });

    it('should grant viewer access to viewer-level resources', () => {
      expect(authService.hasPermission('viewer', 'viewer')).toBe(true);
    });

    it('should deny access for unknown roles (partial result — no matching role)', () => {
      expect(authService.hasPermission('unknown', 'viewer')).toBe(false);
      expect(authService.hasPermission('admin', 'unknown')).toBe(true); // admin always passes
    });

    it('should deny access for empty string roles', () => {
      expect(authService.hasPermission('', 'viewer')).toBe(false);
      expect(authService.hasPermission('admin', '')).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // hashPassword + verifyPassword
  // ──────────────────────────────────────────────────────────────────────
  describe('hashPassword', () => {
    it('should hash a password using bcrypt with correct rounds', async () => {
      mockBcrypt.hash.mockResolvedValue('$2a$12$hashedvalue' as never);
      const hash = await authService.hashPassword('mySecurePass123');
      expect(hash).toBe('$2a$12$hashedvalue');
      expect(mockBcrypt.hash).toHaveBeenCalledWith('mySecurePass123', 12);
    });

    it('should produce a different hash for the same password (salt)', async () => {
      let callCount = 0;
      mockBcrypt.hash.mockImplementation(async () => {
        callCount++;
        return `$2a$12$hash${callCount}` as never;
      });
      const hash1 = await authService.hashPassword('password');
      const hash2 = await authService.hashPassword('password');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('should return true for matching password', async () => {
      mockBcrypt.compare.mockResolvedValue(true as never);
      const result = await authService.verifyPassword('correct-pass', '$2a$12$somehash');
      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);
      const result = await authService.verifyPassword('wrong-pass', '$2a$12$somehash');
      expect(result).toBe(false);
    });

    it('should return false for empty password', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);
      const result = await authService.verifyPassword('', '$2a$12$somehash');
      expect(result).toBe(false);
    });

    it('should return false for empty hash', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);
      const result = await authService.verifyPassword('password', '');
      expect(result).toBe(false);
    });
  });
});
