const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

// User API
export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface UserCreate {
  username: string;
  email: string;
  password: string;
  role?: string;
}

export interface UserUpdate {
  username?: string;
  email?: string;
  password?: string;
  role?: string;
  is_active?: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

export type SortOrder = 'asc' | 'desc';

// File API
export interface UserInfo {
  id: number;
  username: string;
  email: string;
}

export interface VideoFile {
  id: string;
  filename: string;
  filepath: string;
  user_id?: number;
  file_size?: number;
  duration?: number;
  status: string;
  created_at: string;
  owner?: UserInfo;
}

export interface VideoFileUpdate {
  status?: string;
  duration?: number;
}

export interface DetectionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  label?: string;
  model?: string;
}

export interface ViolationImage {
  frame_number: number;
  timestamp: number;
  image_path: string;
  detections: DetectionBox[];
}

export interface DetectionResponse {
  cached: any;
  detection_id: string;
  total_frames: number;
  processed_frames: number;
  violation_count?: number;
  violations: ViolationImage[];
}

// API Client
export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
    // Try to load token from localStorage
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('access_token');
    }
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', token);
    }
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
    }
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  // User Management
  async register(data: UserCreate): Promise<User> {
    const response = await fetch(`${this.baseUrl}/users/register`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Registration failed');
    }
    return response.json();
  }

  async login(data: LoginRequest): Promise<TokenResponse> {
    const response = await fetch(`${this.baseUrl}/users/login`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Login failed');
    }
    const result = await response.json();
    this.setToken(result.access_token);
    return result;
  }

  async getUsers(params: { page?: number; pageSize?: number; sortOrder?: SortOrder } = {}): Promise<PaginatedResponse<User>> {
    const searchParams = new URLSearchParams();
    if (params.page) {
      searchParams.set('page', String(params.page));
    }
    if (params.pageSize) {
      searchParams.set('page_size', String(params.pageSize));
    }
    if (params.sortOrder) {
      searchParams.set('sort_order', params.sortOrder);
    }

    const query = searchParams.toString();
    const response = await fetch(`${this.baseUrl}/users${query ? `?${query}` : ''}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch users');
    return response.json();
  }

  async getUser(id: number): Promise<User> {
    const response = await fetch(`${this.baseUrl}/users/${id}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch user');
    return response.json();
  }

  async updateUser(id: number, data: UserUpdate): Promise<User> {
    const response = await fetch(`${this.baseUrl}/users/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Update failed');
    }
    return response.json();
  }

  async deleteUser(id: number): Promise<void> {
    const response = await fetch(`${this.baseUrl}/users/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete user');
  }

  // File Management
  async uploadFile(file: File, videoId: string): Promise<VideoFile> {
    const formData = new FormData();
    formData.append('file', file);
    if (videoId) {
      formData.append('video_id', videoId);
    }

    const headers: HeadersInit = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.baseUrl}/files/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Upload failed');
    }
    return response.json();
  }

  async getFiles(params: { page?: number; pageSize?: number; sortOrder?: SortOrder } = {}): Promise<PaginatedResponse<VideoFile>> {
    const searchParams = new URLSearchParams();
    if (params.page) {
      searchParams.set('page', String(params.page));
    }
    if (params.pageSize) {
      searchParams.set('page_size', String(params.pageSize));
    }
    if (params.sortOrder) {
      searchParams.set('sort_order', params.sortOrder);
    }

    const query = searchParams.toString();
    const response = await fetch(`${this.baseUrl}/files${query ? `?${query}` : ''}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch files');
    return response.json();
  }

  async getFile(id: string): Promise<VideoFile> {
    const response = await fetch(`${this.baseUrl}/files/${id}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch file');
    return response.json();
  }

  async getUserFiles(userId: number): Promise<VideoFile[]> {
    const response = await fetch(`${this.baseUrl}/files/user/${userId}`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to fetch user files');
    return response.json();
  }

  async updateFile(id: string, data: VideoFileUpdate): Promise<VideoFile> {
    const response = await fetch(`${this.baseUrl}/files/${id}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update file');
    return response.json();
  }

  async deleteFile(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/files/${id}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });
    if (!response.ok) throw new Error('Failed to delete file');
  }

  async detectFile(id: string): Promise<DetectionResponse> {
    const response = await fetch(`${this.baseUrl}/files/${id}/detect`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to run detection');
    }
    return response.json();
  }

  async detectImage(file: File): Promise<any> {
    const formData = new FormData();
    formData.append('file', file);

    const headers: HeadersInit = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    // Không set Content-Type với FormData - để browser tự set

    const response = await fetch(`${this.baseUrl}/files/detect-image`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'Failed to detect image');
    }
    return response.json();
  }
}

// Export singleton instance
export const apiClient = new ApiClient();
