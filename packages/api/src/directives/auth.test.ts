import { GraphQLObjectType, GraphQLString, GraphQLFieldConfig } from 'graphql';

// ── Mock apollo-server-express to provide a stub SchemaDirectiveVisitor ─────
// SchemaDirectiveVisitor was removed from apollo-server-express in v3+.
// The source directive extends it so we provide a minimal base class here.
class StubSchemaDirectiveVisitor {
  public args: Record<string, any>;
  constructor(config: { name: string; args: Record<string, any> }) {
    this.args = config.args;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public visitObject(_type: GraphQLObjectType): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public visitFieldDefinition(
    _field: any,
    _details: { objectType: GraphQLObjectType }
  ): void {}
}

jest.mock('apollo-server-express', () => ({
  SchemaDirectiveVisitor: StubSchemaDirectiveVisitor,
}));

// ── Mock authService ─────────────────────────────────────────────────────────
const mockHasPermission = jest.fn();
jest.mock('../services/auth', () => ({
  authService: {
    hasPermission: mockHasPermission,
  },
}));

// Must be imported AFTER the mocks above
import { AuthDirective } from './auth';

describe('AuthDirective', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helper: create a mock GraphQLObjectType with name + secretData fields
  // ──────────────────────────────────────────────────────────────────────
  function createMockType(name: string): GraphQLObjectType {
    const fieldConfig: GraphQLFieldConfig<any, any> = {
      type: GraphQLString,
      resolve: (source: any) => source?.name ?? null,
    };

    return new GraphQLObjectType({
      name,
      fields: () => ({
        name: fieldConfig,
        secretData: {
          type: GraphQLString,
          resolve: (source: any) => source?.secretData ?? null,
        },
      }),
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // visitObject — type-level auth
  // ──────────────────────────────────────────────────────────────────────
  describe('visitObject (type-level auth)', () => {
    it('should allow access when user satisfies the required role', async () => {
      mockHasPermission.mockReturnValue(true);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('AdminOnlyType');
      directive.visitObject(type);

      const nameField = type.getFields()['name'];
      expect(nameField).toBeDefined();

      const result = await nameField!.resolve!(
        { name: 'Test' },
        {},
        { user: { id: '1', role: 'admin' } },
        {} as any
      );
      expect(result).toBe('Test');
    });

    it('should throw "Not authorized" for unauthenticated requests (null user)', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('AdminOnlyType');
      directive.visitObject(type);

      const nameField = type.getFields()['name'];

      await expect(
        nameField!.resolve!(
          { name: 'Test' },
          {},
          { user: null },
          {} as any
        )
      ).rejects.toThrow('Not authorized');
    });

    it('should throw "Not authorized" for undefined user context', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('AdminOnlyType');
      directive.visitObject(type);

      const nameField = type.getFields()['name'];

      await expect(
        nameField!.resolve!(
          { name: 'Test' },
          {},
          {}, // no user in context
          {} as any
        )
      ).rejects.toThrow('Not authorized');
    });

    it('should throw for viewer role when admin is required (partial result)', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('AdminOnlyType');
      directive.visitObject(type);

      const nameField = type.getFields()['name'];

      await expect(
        nameField!.resolve!(
          { name: 'Test' },
          {},
          { user: { id: '2', role: 'viewer' } },
          {} as any
        )
      ).rejects.toThrow('Not authorized');

      expect(mockHasPermission).toHaveBeenCalledWith('viewer', 'admin');
    });

    it('should throw for user role when admin is required', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('AdminOnlyType');
      directive.visitObject(type);

      const nameField = type.getFields()['name'];

      await expect(
        nameField!.resolve!(
          { name: 'Test' },
          {},
          { user: { id: '3', role: 'user' } },
          {} as any
        )
      ).rejects.toThrow('Not authorized');
    });

    it('should allow admin to access viewer-required resources', async () => {
      mockHasPermission.mockReturnValue(true);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'viewer' } });
      const type = createMockType('ViewerType');
      directive.visitObject(type);

      const nameField = type.getFields()['name'];

      const result = await nameField!.resolve!(
        { name: 'Public data' },
        {},
        { user: { id: '1', role: 'admin' } },
        {} as any
      );
      expect(result).toBe('Public data');
    });

    it('should protect all fields on the object type', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('FullyProtectedType');
      directive.visitObject(type);

      // Both name and secretData fields should be protected
      const nameField = type.getFields()['name'];
      const secretField = type.getFields()['secretData'];

      await expect(
        nameField!.resolve!(
          { name: 'public-name' },
          {},
          { user: null },
          {} as any
        )
      ).rejects.toThrow('Not authorized');

      await expect(
        secretField!.resolve!(
          { secretData: 'classified' },
          {},
          { user: null },
          {} as any
        )
      ).rejects.toThrow('Not authorized');
    });

    it('should not double-wrap fields if visitObject is called twice', async () => {
      mockHasPermission.mockReturnValue(true);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'user' } });
      const type = createMockType('DoubleWrappedType');

      directive.visitObject(type);
      directive.visitObject(type);

      const nameField = type.getFields()['name'];
      const result = await nameField!.resolve!(
        { name: 'OK' },
        {},
        { user: { id: '1', role: 'user' } },
        {} as any
      );
      expect(result).toBe('OK');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // visitFieldDefinition — field-level auth
  // ──────────────────────────────────────────────────────────────────────
  describe('visitFieldDefinition (field-level auth)', () => {
    it('should protect a specific field while leaving others unprotected', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('PartiallyProtectedType');
      const secretField = type.getFields()['secretData'];

      directive.visitFieldDefinition(secretField!, { objectType: type });

      // secretData field should be protected
      await expect(
        secretField!.resolve!(
          { secretData: 'top-secret' },
          {},
          { user: { id: '1', role: 'viewer' } },
          {} as any
        )
      ).rejects.toThrow('Not authorized');

      // name field should remain unprotected (no auth requirement set)
      const nameField = type.getFields()['name'];
      const result = await nameField!.resolve!(
        { name: 'Public' },
        {},
        { user: null },
        {} as any
      );
      expect(result).toBe('Public');
    });

    it('should allow access to protected field when user has sufficient role', async () => {
      mockHasPermission.mockReturnValue(true);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'user' } });
      const type = createMockType('UserProtectedType');
      const secretField = type.getFields()['secretData'];

      directive.visitFieldDefinition(secretField!, { objectType: type });

      const result = await secretField!.resolve!(
        { secretData: 'semi-sensitive' },
        {},
        { user: { id: '2', role: 'user' } },
        {} as any
      );
      expect(result).toBe('semi-sensitive');
    });

    it('should enforce field-level auth requiring role above admin', async () => {
      mockHasPermission.mockReturnValue(false);

      const fieldDirective = new AuthDirective({ name: 'auth', args: { requires: 'superadmin' } });
      const freshType = createMockType('FieldOnlyType');
      fieldDirective.visitFieldDefinition(freshType.getFields()['secretData']!, { objectType: freshType });

      await expect(
        freshType.getFields()['secretData']!.resolve!(
          { secretData: 'ultra-secret' },
          {},
          { user: { id: '1', role: 'admin' } },
          {} as any
        )
      ).rejects.toThrow('Not authorized');
    });

    it('should handle unauthenticated requests for field-level auth', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'user' } });
      const type = createMockType('AuthRequiredType');

      directive.visitFieldDefinition(type.getFields()['secretData']!, { objectType: type });

      await expect(
        type.getFields()['secretData']!.resolve!(
          { secretData: 'data' },
          {},
          { user: null },
          {} as any
        )
      ).rejects.toThrow('Not authorized');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('should allow access when no auth role is required on type or field', () => {
      const type = createMockType('PublicType');
      const nameField = type.getFields()['name'];
      expect(() =>
        nameField!.resolve!({ name: 'public' }, {}, { user: null }, {} as any)
      ).not.toThrow();
    });

    it('should preserve async resolver return values when authorized', async () => {
      mockHasPermission.mockReturnValue(true);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'user' } });
      const type = new GraphQLObjectType({
        name: 'CustomReturnType',
        fields: () => ({
          data: {
            type: GraphQLString,
            resolve: async () => Promise.resolve('async-result'),
          },
        }),
      });
      directive.visitObject(type);

      const result = await type.getFields()['data']!.resolve!(
        {},
        {},
        { user: { id: '1', role: 'user' } },
        {} as any
      );
      expect(result).toBe('async-result');
    });

    it('should handle unauthenticated request with user explicitly set to undefined', async () => {
      mockHasPermission.mockReturnValue(false);

      const directive = new AuthDirective({ name: 'auth', args: { requires: 'admin' } });
      const type = createMockType('SecuredType');
      directive.visitObject(type);

      await expect(
        type.getFields()['name']!.resolve!(
          { name: 'hidden' },
          {},
          { user: undefined },
          {} as any
        )
      ).rejects.toThrow('Not authorized');
    });
  });
});
