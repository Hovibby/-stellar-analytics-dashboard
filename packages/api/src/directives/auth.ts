import { SchemaDirectiveVisitor } from 'apollo-server-express';
import { defaultFieldResolver, GraphQLField, GraphQLObjectType } from 'graphql';
import { authService } from '../services/auth';

export class AuthDirective extends SchemaDirectiveVisitor {
  public visitObject(type: GraphQLObjectType) {
    this.ensureFieldsWrapped(type);
    type._requiredAuthRole = this.args.requires;
  }

  public visitFieldDefinition(
    field: GraphQLField<any, any>,
    details: { objectType: GraphQLObjectType }
  ) {
    this.ensureFieldsWrapped(details.objectType);
    field._requiredAuthRole = this.args.requires;
  }

  private ensureFieldsWrapped(objectType: GraphQLObjectType) {
    if (objectType._authFieldsWrapped) {
      return;
    }
    objectType._authFieldsWrapped = true;

    const fields = objectType.getFields();

    Object.keys(fields).forEach((fieldName) => {
      const field = fields[fieldName];
      const { resolve = defaultFieldResolver } = field;

      field.resolve = async function (...args) {
        const requiredRole = field._requiredAuthRole || objectType._requiredAuthRole;

        if (!requiredRole) {
          return resolve.apply(this, args);
        }

        const context = args[2];
        const user = context.user;

        if (!user || !authService.hasPermission(user.role, requiredRole)) {
          throw new Error('Not authorized');
        }

        return resolve.apply(this, args);
      };
    });
  }
}
