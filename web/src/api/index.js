import http from './http'

export const authApi = {
  register: (data) => http.post('/auth/register', data),
  login: (data) => http.post('/auth/login', data),
  sendEmailCode: (data) => http.post('/auth/email/send-code', data),
  resetPassword: (data) => http.post('/auth/password/reset', data),
  logout: () => http.post('/auth/logout'),
  me: () => http.get('/auth/me'),
  updateProfile: (data) => http.patch('/auth/profile', data),
  changePassword: (data) => http.post('/auth/change-password', data),
}

export const categoryApi = {
  list: (params) => http.get('/categories', { params }),
  create: (data) => http.post('/categories', data),
  update: (id, data) => http.put(`/categories/${id}`, data),
  remove: (id) => http.delete(`/categories/${id}`),
}

export const recordApi = {
  list: (params) => http.get('/records', { params }),
  create: (data) => http.post('/records', data),
  update: (id, data) => http.put(`/records/${id}`, data),
  remove: (id) => http.delete(`/records/${id}`),
  get: (id) => http.get(`/records/${id}`),
}

export const budgetApi = {
  get: (month) => http.get('/budgets', { params: { month } }),
  set: (data) => http.put('/budgets', data),
  remove: (month) => http.delete('/budgets', { params: { month } }),
}

export const statsApi = {
  overview: (params) => http.get('/stats/overview', { params }),
  summary: (params) => http.get('/stats/summary', { params }),
}

export const aiApi = {
  status: () => http.get('/ai/status'),
  parse: (text) => http.post('/ai/parse', { text }),
  chat: (message) => http.post('/ai/chat', { message }),
  receipt: (image) => http.post('/ai/receipt', { image }),
}

export const adminApi = {
  overview: () => http.get('/admin/overview'),
  growth: (params) => http.get('/admin/growth', { params }),
  activity: (params) => http.get('/admin/activity', { params }),
  layers: () => http.get('/admin/layers'),
  charts: (params) => http.get('/admin/charts', { params }),
  users: (params) => http.get('/admin/users', { params }),
  createUser: (data) => http.post('/admin/users', data),
  updateUser: (id, data) => http.put(`/admin/users/${id}`, data),
  removeUser: (id) => http.delete(`/admin/users/${id}`),
  ranking: (params) => http.get('/admin/ranking', { params }),
}
