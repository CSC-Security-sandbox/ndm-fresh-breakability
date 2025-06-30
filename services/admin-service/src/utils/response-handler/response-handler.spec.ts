import { ResponseHandler, setMessage } from './response-handler';
import { MessageCatalog, ErrorCatalog } from './response-interface';

describe('setMessage', () => {
  const mockRequest = (path = '/user-status', method = 'POST') => ({
    route: { path },
    method
  }) as any;

  it('returns default message if no route', () => {
    expect(setMessage(mockRequest('/abcd'),{})).toBe('Request Processed Successfully');
  });

  it('returns message from MessageCatalog for user_status', () => {
    MessageCatalog['create-user'] = jest.fn().mockReturnValue({ message: 'User Disabled' });
    const data = { user_status: 'inactive', email: 'test@example.com' };
    expect(setMessage(mockRequest('/create-user'), data)).toBe('User Disabled');
    expect(MessageCatalog['create-user']).toHaveBeenCalledWith('Disabled', 'test@example.com');
  });

  it('returns message from data.message if present', () => {
    const data = { message: 'Custom message' };
    expect(setMessage(mockRequest('/projects/:id'), data)).toBe('Custom message');
  });

  it('returns default message if nothing matches', () => {
    expect(setMessage(mockRequest('/bar'), {})).toBe('Request Processed Successfully');
  });
});


describe('ResponseHandler', () => {
  const mockRequest = (path = '/user-status', method = 'POST') => ({
    route: { path },
    method
  }) as any;

  describe('success', () => {
    it('wraps array data', () => {
      const req = mockRequest('/user-status');
      MessageCatalog['user-status'] = jest.fn().mockReturnValue({ message: 'User Disabled' });
      const data = { user_status: 'active', email: 'test@example.com' };
      const result = ResponseHandler.success(data, req);
      expect(result.data).toEqual({items:{ user_status: 'active', email: 'test@example.com' }});
    });
    it('wraps array data with pagination', () => {
      const req = mockRequest('/users?limit=1000');
      const result = ResponseHandler.success(
        [
          {
            "created_at": "2025-06-29T23:32:02.656Z",
            "created_by": {
              "id": "123",
              "email": "admin@datamigrator.local",
              "user_status": "active"
            },
            "updated_at": "2025-06-30T09:15:33.940Z",
            "updated_by": {
              "id": "123",
              "email": "admin@datamigrator.local",
              "user_status": "active"
            },
            "id": "2ebdefd2-bddd-4794-84ed-115e91204a9f",
            "email": "geetha-shree.ms@calfus.com",
            "first_name": "Geetha Shree",
            "last_name": "M S",
            "user_status": "active",
            "isAppAdmin": true
          }
        ],
        req
      );
      expect(result.data.items).toEqual([
        {
          "created_at": "2025-06-29T23:32:02.656Z",
          "created_by": {
            "id": "123",
            "email": "admin@datamigrator.local",
            "user_status": "active"
          },
          "updated_at": "2025-06-30T09:15:33.940Z",
          "updated_by": {
            "id": "123",
            "email": "admin@datamigrator.local",
            "user_status": "active"
          },
          "id": "2ebdefd2-bddd-4794-84ed-115e91204a9f",
          "email": "geetha-shree.ms@calfus.com",
          "first_name": "Geetha Shree",
          "last_name": "M S",
          "user_status": "active",
          "isAppAdmin": true
        }
      ]);
    });
    it('wraps object data and extracts id', () => {
      const req = mockRequest();
      const result = ResponseHandler.success(
        { id: "123", email: "admin@datamigrator.local"  },
        req
      );
      expect(result.data['id']).toBe("123");
      expect(result.data['items']).toEqual({ email: "admin@datamigrator.local"});
    });
  });
  describe('error', () => {
    it('returns error message from response', () => {
      const error = { response: { message: 'Bad request' } };
      const result = ResponseHandler.error(error);
      expect(result.message).toBe('Bad request');
      expect(result.error.displayMessage).toBe('Bad request');
    });

    it('returns error message from ErrorCatalog', () => {
      ErrorCatalog['ERR'] = { message: 'Catalog error' };
      const error = { code: 'ERR' };
      const result = ResponseHandler.error(error);
      expect(result.message).toBe('Catalog error');
      expect(result.error.displayMessage).toBe('Catalog error');
    });

    it('returns undefined if no error message found', () => {
      const error = {};
      const result = ResponseHandler.error(error);
      expect(result.message).toBeUndefined();
      expect(result.error.displayMessage).toBeUndefined();
    });
  });
});