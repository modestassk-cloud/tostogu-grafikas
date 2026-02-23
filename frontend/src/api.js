const API_BASE = import.meta.env.VITE_API_BASE || '';

async function request(path, { method = 'GET', body, managerToken } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(managerToken ? { 'x-manager-token': managerToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || 'Užklausa nepavyko.');
  }

  return payload;
}

export async function fetchVacations({
  managerToken,
  department,
  includeRejected = false,
} = {}) {
  if (managerToken && department) {
    const query = includeRejected ? '?includeRejected=true' : '';
    const payload = await request(`/api/manager/${department}/vacations${query}`, { managerToken });
    return payload.vacations || [];
  }

  const payload = await request(`/api/vacations?department=${encodeURIComponent(department || '')}`);
  return payload.vacations || [];
}

export async function createVacationRequest(data) {
  const payload = await request('/api/vacations', {
    method: 'POST',
    body: data,
  });

  return payload.vacation;
}

export async function validateManagerSession({ managerToken, department }) {
  return request(`/api/manager/${department}/session`, { managerToken });
}

export async function patchVacationAsManager({ id, managerToken, department, updates }) {
  const payload = await request(`/api/manager/${department}/vacations/${id}`, {
    method: 'PATCH',
    managerToken,
    body: updates,
  });

  return payload.vacation;
}

export async function approveVacation({ id, managerToken, department }) {
  const payload = await request(`/api/manager/${department}/vacations/${id}/approve`, {
    method: 'POST',
    managerToken,
  });

  return payload.vacation;
}

export async function rejectVacation({ id, managerToken, department }) {
  const payload = await request(`/api/manager/${department}/vacations/${id}/reject`, {
    method: 'POST',
    managerToken,
  });

  return payload.vacation;
}
