import { lazy } from 'react';

/**
 * The owner's admin panel tabs (Admin > Overview, Companies, Sales leads, Users, Contractors, System, Audit). Each is its
 * own lazy chunk: only admins ever download them.
 */
export const AdminDashboardTab = lazy(() => import('./AdminDashboard'));
export const AdminCompaniesTab = lazy(() => import('./AdminCompanies'));
export const AdminSalesLeadsTab = lazy(() => import('./AdminSalesLeads'));
export const AdminUsersTab = lazy(() => import('./AdminUsers'));
export const AdminContractorsTab = lazy(() => import('./AdminContractors'));
export const AdminSystemTab = lazy(() => import('./AdminSystem'));
export const AdminAuditTab = lazy(() => import('./AdminAudit'));
