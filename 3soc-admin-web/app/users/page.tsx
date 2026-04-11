'use client';

import React, {useState, useEffect} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Table} from '@/components/ui/table';
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog';
import {Label} from '@/components/ui/label';
import {apiClient, User, UserCreate, UserUpdate, SortOrder} from '@/app/api';
import {Users, Plus, Edit, Trash2, Shield} from 'lucide-react';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {useAuth} from '@/contexts/AuthContext';
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious
} from '@/components/ui/pagination';

export default function UsersPage() {
    const { isAdmin } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [formData, setFormData] = useState<UserCreate>({
        username: '',
        email: '',
        password: '',
        role: 'user',
    });
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [totalPages, setTotalPages] = useState(0);
    const [totalUsers, setTotalUsers] = useState(0);
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    useEffect(() => {
        loadUsers(page);
    }, [page, sortOrder]);

    const loadUsers = async (targetPage = page) => {
        try {
            setLoading(true);
            const data = await apiClient.getUsers({page: targetPage, pageSize, sortOrder});

            // If current page becomes invalid after mutation (e.g., delete), move to last valid page.
            if (data.meta.total_pages > 0 && targetPage > data.meta.total_pages) {
                setPage(data.meta.total_pages);
                return;
            }

            setUsers(data.items);
            setTotalPages(data.meta.total_pages);
            setTotalUsers(data.meta.total);
            setError('');
        } catch (err: any) {
            setError(err.message || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (editingUser) {
                const payload: UserUpdate = {
                    username: formData.username,
                    email: formData.email,
                    role: formData.role,
                };

                if (formData.password.trim()) {
                    payload.password = formData.password;
                }

                await apiClient.updateUser(editingUser.id, payload);
            } else {
                await apiClient.register(formData);
            }
            setIsDialogOpen(false);
            resetForm();
            loadUsers(page);
        } catch (err: any) {
            setError(err.message || 'Operation failed');
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Are you sure you want to delete this user?')) return;
        try {
            await apiClient.deleteUser(id);
            loadUsers(page);
        } catch (err: any) {
            setError(err.message || 'Failed to delete user');
        }
    };

    const visiblePages = (() => {
        if (totalPages <= 5) {
            return Array.from({length: totalPages}, (_, i) => i + 1);
        }

        const start = Math.max(1, page - 2);
        const end = Math.min(totalPages, start + 4);
        return Array.from({length: end - start + 1}, (_, i) => start + i);
    })();

    const handleEdit = (user: User) => {
        setEditingUser(user);
        setFormData({
            username: user.username,
            email: user.email,
            password: '',
            role: user.role,
        });
        setIsDialogOpen(true);
    };

    const resetForm = () => {
        setEditingUser(null);
        setFormData({
            username: '',
            email: '',
            password: '',
            role: 'user',
        });
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('vi-VN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Guard: only admin can access
    if (!isAdmin) {
        return (
            <div className="min-h-screen bg-background p-6 flex items-center justify-center">
                <Alert variant="destructive" className="max-w-md">
                    <AlertDescription>
                        Bạn không có quyền truy cập trang này. Vui lòng liên hệ quản trị viên.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <Users className="text-primary" size={32}/>
                        <h1 className="text-3xl font-bold">Quản lý người dùng</h1>
                    </div>
                    <p className="text-muted-foreground">Danh sách thông tin người dùng</p>
                </div>

                {error && (
                    <Alert variant="destructive" className="mb-4">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                            <DialogTrigger asChild>
                                <Button onClick={resetForm}>
                                    <Plus size={16} className="mr-2"/>
                                    Thêm mới
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>{editingUser ? 'Chỉnh sửa' : 'Thêm mới'}</DialogTitle>
                                </DialogHeader>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div>
                                        <Label htmlFor="username">Username</Label>
                                        <Input
                                            id="username"
                                            value={formData.username}
                                            onChange={(e) => setFormData({...formData, username: e.target.value})}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor="email">Email</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            value={formData.email}
                                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <Label
                                            htmlFor="password">Password {editingUser && '(leave blank to keep current)'}</Label>
                                        <Input
                                            id="password"
                                            type="password"
                                            value={formData.password}
                                            onChange={(e) => setFormData({...formData, password: e.target.value})}
                                            required={!editingUser}
                                        />
                                    </div>
                                    <div>
                                        <Label htmlFor="role">Role</Label>
                                        <select
                                            id="role"
                                            value={formData.role}
                                            onChange={(e) => setFormData({...formData, role: e.target.value})}
                                            className="w-full px-3 py-2 border border-input rounded-md bg-background"
                                        >
                                            <option value="user">User</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                        <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                                            Cancel
                                        </Button>
                                        <Button type="submit">{editingUser ? 'Update' : 'Create'}</Button>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <div className="text-center py-8 text-muted-foreground">Loading...</div>
                        ) : users.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground">No users found</div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full">
                                    <thead>
                                    <tr className="border-b">
                                        <th className="text-left p-4">STT</th>
                                        <th className="text-left p-4">Username</th>
                                        <th className="text-left p-4">Email</th>
                                        <th className="text-left p-4">Vai trò</th>
                                        <th className="text-left p-4">Trạng thái</th>
                                        <th className="text-left p-4">Thời gian tạo</th>
                                        <th className="text-right p-4">Thao tác</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {users.map((user, index) => (
                                        <tr key={user.id} className="border-b hover:bg-muted/50">
                                            <td className="p-4">{(page - 1) * pageSize + index + 1}</td>
                                            <td className="p-4 font-medium">{user.username}</td>
                                            <td className="p-4">{user.email}</td>
                                            <td className="p-4">
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
                              user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                          }`}>
                            {user.role === 'admin' && <Shield size={12}/>}
                              {user.role}
                          </span>
                                            </td>
                                            <td className="p-4">
                          <span className={`px-2 py-1 rounded-md text-xs ${
                              user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                                            </td>
                                            <td className="p-4 text-sm text-muted-foreground">{formatDate(user.created_at)}</td>
                                            <td className="p-4">
                                                <div className="flex gap-2 justify-end">
                                                    <Button size="sm" variant="outline"
                                                            onClick={() => handleEdit(user)}>
                                                        <Edit size={14}/>
                                                    </Button>
                                                    <Button size="sm" variant="destructive"
                                                            onClick={() => handleDelete(user.id)}>
                                                        <Trash2 size={14}/>
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>

                                <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                                        <p className="text-sm text-muted-foreground">
                                            Tổng {totalUsers} người dùng
                                        </p>
                                        <select
                                            value={sortOrder}
                                            onChange={(e) => {
                                                setSortOrder(e.target.value as SortOrder);
                                                setPage(1);
                                            }}
                                            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                                        >
                                            <option value="desc">Mới nhất</option>
                                            <option value="asc">Cũ nhất</option>
                                        </select>
                                    </div>

                                    <Pagination className="mx-0 w-auto justify-end">
                                        <PaginationContent>
                                            <PaginationItem>
                                                <PaginationPrevious
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        if (page > 1) {
                                                            setPage(page - 1);
                                                        }
                                                    }}
                                                    className={page <= 1 ? 'pointer-events-none opacity-50' : ''}
                                                />
                                            </PaginationItem>

                                            {visiblePages.map((pageNum) => (
                                                <PaginationItem key={pageNum}>
                                                    <PaginationLink
                                                        href="#"
                                                        isActive={pageNum === page}
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            setPage(pageNum);
                                                        }}
                                                    >
                                                        {pageNum}
                                                    </PaginationLink>
                                                </PaginationItem>
                                            ))}

                                            <PaginationItem>
                                                <PaginationNext
                                                    href="#"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        if (page < totalPages) {
                                                            setPage(page + 1);
                                                        }
                                                    }}
                                                    className={page >= totalPages || totalPages === 0 ? 'pointer-events-none opacity-50' : ''}
                                                />
                                            </PaginationItem>
                                        </PaginationContent>
                                    </Pagination>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
