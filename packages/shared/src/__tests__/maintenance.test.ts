import { isBackendMaintenanceResponse } from '../maintenance';

describe('isBackendMaintenanceResponse', () => {
  it('treats gateway errors and Railway "Application not found" as maintenance', () => {
    expect(isBackendMaintenanceResponse(502, '')).toBe(true);
    expect(isBackendMaintenanceResponse(503, null)).toBe(true);
    expect(isBackendMaintenanceResponse(504, undefined)).toBe(true);
    expect(isBackendMaintenanceResponse(404, '{"status":"error","code":404,"message":"Application not found"}')).toBe(true);
  });
  it('never flags real API answers', () => {
    expect(isBackendMaintenanceResponse(404, '{"error":{"code":"NOT_FOUND","message":"Salon not found"}}')).toBe(false);
    expect(isBackendMaintenanceResponse(500, 'x')).toBe(false);
    expect(isBackendMaintenanceResponse(401, '')).toBe(false);
    expect(isBackendMaintenanceResponse(200, 'Application not found')).toBe(false);
  });
});
