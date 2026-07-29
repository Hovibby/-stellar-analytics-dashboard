import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'viewer';
  apiKey?: string;
  createdAt: string;
}

export interface AuthPayload {
  user: User;
  token: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
}

export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiresIn = '24h';
  private readonly bcryptRounds = 12;
  private readonly apiKeyPrefix = 'sad_';

  constructor(jwtSecret?: string) {
    this.jwtSecret = jwtSecret || process.env.JWT_SECRET || 'default-development-secret-change-in-production-32chars';
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.bcryptRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  generateToken(user: User): string {
    const payload: JwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };
    return jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresIn });
  }

  verifyToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, this.jwtSecret) as JwtPayload;
    } catch {
      return null;
    }
  }

  extractToken(authorization?: string): string | null {
    if (!authorization) return null;
    const parts = authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
      return parts[1];
    }
    return null;
  }

  generateApiKey(): string {
    return `${this.apiKeyPrefix}${crypto.randomBytes(32).toString('hex')}`;
  }

  validateApiKey(apiKey: string): boolean {
    if (!apiKey) return false;
    return apiKey.startsWith(this.apiKeyPrefix) && apiKey.length > this.apiKeyPrefix.length;
  }

  hasPermission(userRole: string, requiredRole: string): boolean {
    const roleHierarchy: Record<string, number> = {
      viewer: 1,
      user: 2,
      admin: 3,
    };
    const userLevel = roleHierarchy[userRole] || 0;
    const requiredLevel = roleHierarchy[requiredRole] || 0;
    return userLevel >= requiredLevel;
  }
}

export const authService = new AuthService();
