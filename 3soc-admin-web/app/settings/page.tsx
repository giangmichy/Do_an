'use client';

import React, {useState, useEffect} from 'react';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@/components/ui/tabs';
import {User, Lock, Settings, LogOut, Users} from 'lucide-react';
import {useRouter} from 'next/navigation';
import {useToast} from '@/hooks/use-toast';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api').replace(/\/api\/?$/, '');

export default function SettingsPage() {
    const router = useRouter();
    const {toast} = useToast();
    const [user, setUser] = useState({
        username: '',
        email: '',
        createdAt: new Date().toISOString(),
        role: 'user'
    });

    const [passwordData, setPasswordData] = useState({
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
    });

    const [settings, setSettings] = useState({
        detectionFps: typeof window !== 'undefined' ? parseInt(localStorage.getItem('detectionFps') || '50', 10) : 50,
        theme: 'dark'
    });

    const [message, setMessage] = useState({type: '', text: ''});
    const [loading, setLoading] = useState(false);

    // Fetch current user on mount
    useEffect(() => {
        fetchCurrentUser();
    }, []);

    const getAuthToken = () => {
        return localStorage.getItem('access_token');
    };

    const fetchCurrentUser = async () => {
        try {
            const token = getAuthToken();
            if (!token) {
                console.log('No token found - user may not be logged in');
                setMessage({type: 'error', text: 'Vui lòng đăng nhập để xem trang này'});
                return;
            }

            console.log('Fetching current user...');
            const response = await fetch(`${API_URL}/api/users/me`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                }
            });

            console.log('Response status:', response.status);
            if (response.status === 401) {
                console.log('Unauthorized - token may be expired');
                setMessage({type: 'error', text: 'Token hết hạn. Vui lòng đăng nhập lại.'});
                return;
            }

            if (!response.ok) {
                console.error('Failed to fetch user:', response.status);
                setMessage({type: 'error', text: 'Không thể tải thông tin. Backend có chạy không?'});
                return;
            }

            const userData = await response.json();
            console.log('User data received:', userData);
            setUser({
                username: userData.username,
                email: userData.email,
                createdAt: userData.created_at,
                role: userData.role || 'user'
            });
            setMessage({type: '', text: ''});
        } catch (error) {
            console.error('Error fetching user:', error);
            setMessage({type: 'error', text: `Lỗi kết nối: ${error}. Kiểm tra backend: ${API_URL}`});
        }
    };

    const handlePasswordChange = async () => {
        if (!passwordData.oldPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
            toast({
                title: 'Lỗi',
                description: 'Vui lòng điền đầy đủ thông tin',
                variant: 'destructive'
            });
            return;
        }

        if (passwordData.newPassword !== passwordData.confirmPassword) {
            toast({
                title: 'Lỗi',
                description: 'Mật khẩu mới không khớp',
                variant: 'destructive'
            });
            return;
        }

        if (passwordData.newPassword.length < 6) {
            toast({
                title: 'Lỗi',
                description: 'Mật khẩu phải có ít nhất 6 ký tự',
                variant: 'destructive'
            });
            return;
        }

        setLoading(true);
        try {
            const token = getAuthToken();
            if (!token) {
                toast({
                    title: 'Lỗi',
                    description: 'Vui lòng đăng nhập lại',
                    variant: 'destructive'
                });
                router.push('/login');
                return;
            }

            const response = await fetch(`${API_URL}/api/users/change-password`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    old_password: passwordData.oldPassword,
                    new_password: passwordData.newPassword
                })
            });

            if (response.status === 401) {
                toast({
                    title: 'Lỗi',
                    description: 'Mật khẩu cũ không đúng',
                    variant: 'destructive'
                });
            } else if (!response.ok) {
                const error = await response.json();
                toast({
                    title: 'Lỗi',
                    description: error.detail || 'Đổi mật khẩu thất bại',
                    variant: 'destructive'
                });
            } else {
                toast({
                    title: 'Thành công',
                    description: 'Đổi mật khẩu thành công'
                });
                setPasswordData({oldPassword: '', newPassword: '', confirmPassword: ''});
            }
        } catch (error: any) {
            toast({
                title: 'Lỗi',
                description: error.message || 'Đổi mật khẩu thất bại',
                variant: 'destructive'
            });
        } finally {
            setLoading(false);
        }
    };

    const handleSettingsChange = (key: string, value: any) => {
        setSettings({...settings, [key]: value});

        // Save to localStorage
        if (key === 'detectionFps') {
            localStorage.setItem('detectionFps', value.toString());
        } else if (key === 'theme') {
            localStorage.setItem('theme', value);
        }

        toast({
            title: 'Thành công',
            description: 'Cài đặt đã lưu'
        });
    };

    const handleLogout = async () => {
        try {
            const token = getAuthToken();

            // Call logout API
            if (token) {
                try {
                    await fetch(`${API_URL}/api/users/logout`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        }
                    });
                } catch (error) {
                    console.error('Error calling logout API:', error);
                }
            }

            // Clear auth token from localStorage (standard key)
            localStorage.removeItem('access_token');
            // Also clear any legacy key for safety
            localStorage.removeItem('auth_token');

            toast({
                title: 'Thành công',
                description: 'Đã đăng xuất'
            });

            // Redirect to login
            setTimeout(() => router.push('/login'), 500);
        } catch (error) {
            toast({
                title: 'Lỗi',
                description: 'Đăng xuất thất bại',
                variant: 'destructive'
            });
        }
    };

    return (
        <div className="min-h-screen bg-background p-6">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <Settings className="text-primary" size={32}/>
                        <h1 className="text-3xl font-bold">Cài đặt</h1>
                    </div>
                    <p className="text-muted-foreground">Quản lý tài khoản và cài đặt hệ thống</p>
                </div>

                {/* Message Alert */}
                {message.text && (
                    <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className="mb-6">
                        <AlertDescription>{message.text}</AlertDescription>
                    </Alert>
                )}

                {/* Tabs */}
                <Tabs defaultValue="account" className="space-y-6">
                    <TabsList className={`grid w-full ${user?.role === 'admin' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        <TabsTrigger value="account">Tài khoản</TabsTrigger>
                        <TabsTrigger value="password">Mật khẩu</TabsTrigger>
                        {user?.role === 'admin' && <TabsTrigger value="system">Hệ thống</TabsTrigger>}
                    </TabsList>

                    {/* Account Tab */}
                    <TabsContent value="account">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <User size={20}/>
                                    Thông tin tài khoản
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Username */}
                                <div>
                                    <label className="text-sm font-semibold mb-2 block">Tên đăng nhập</label>
                                    <Input
                                        value={user.username}
                                        disabled
                                        className="bg-muted"
                                    />
                                </div>

                                {/* Email */}
                                <div>
                                    <label className="text-sm font-semibold mb-2 block">Email</label>
                                    <Input
                                        value={user.email}
                                        disabled
                                        className="bg-muted"
                                    />
                                </div>

                                {/* Role */}
                                <div>
                                    <label className="text-sm font-semibold mb-2 block">Vai trò</label>
                                    <Input
                                        value={user?.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}
                                        disabled
                                        className="bg-muted"
                                    />
                                </div>

                                {/* Created Date */}
                                <div>
                                    <label className="text-sm font-semibold mb-2 block">Ngày tạo tài khoản</label>
                                    <Input
                                        value={new Date(user?.createdAt).toLocaleDateString('vi-VN')}
                                        disabled
                                        className="bg-muted"
                                    />
                                </div>

                                {/* Logout Button */}
                                <Button
                                    onClick={handleLogout}
                                    variant="destructive"
                                    className="w-full flex items-center gap-2"
                                >
                                    <LogOut size={16}/>
                                    Đăng xuất
                                </Button>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Password Tab */}
                    <TabsContent value="password">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Lock size={20}/>
                                    Đổi mật khẩu
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Old Password */}
                                <div>
                                    <label className="text-sm font-semibold mb-2 block">Mật khẩu hiện tại</label>
                                    <Input
                                        type="password"
                                        placeholder="Nhập mật khẩu hiện tại"
                                        value={passwordData.oldPassword}
                                        onChange={(e) => setPasswordData({
                                            ...passwordData,
                                            oldPassword: e.target.value
                                        })}
                                    />
                                </div>

                                {/* New Password */}
                                <div>
                                    <label className="text-sm font-semibold mb-2 block">Mật khẩu mới</label>
                                    <Input
                                        type="password"
                                        placeholder="Nhập mật khẩu mới"
                                        value={passwordData.newPassword}
                                        onChange={(e) => setPasswordData({
                                            ...passwordData,
                                            newPassword: e.target.value
                                        })}
                                    />
                                </div>

                                {/* Confirm Password */}
                                <div>
                                    <label className="text-sm font-semibold mb-2 block">Xác nhận mật khẩu</label>
                                    <Input
                                        type="password"
                                        placeholder="Nhập lại mật khẩu mới"
                                        value={passwordData.confirmPassword}
                                        onChange={(e) => setPasswordData({
                                            ...passwordData,
                                            confirmPassword: e.target.value
                                        })}
                                    />
                                </div>

                                {/* Save Button */}
                                <Button
                                    onClick={handlePasswordChange}
                                    disabled={loading}
                                    className="w-full"
                                >
                                    {loading ? 'Đang xử lý...' : 'Đổi mật khẩu'}
                                </Button>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Admin Management Tab */}
                    {user?.role === 'admin' && (
                        <TabsContent value="admin">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Users size={20}/>
                                        Quản lý hệ thống
                                    </CardTitle>
                                </CardHeader>
                            </Card>
                        </TabsContent>
                    )}

                    {/* System Settings Tab */}
                    {user?.role === 'admin' && (
                        <TabsContent value="system">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Settings size={20}/>
                                        Cài đặt hệ thống
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-6">
                                    {/* Detection FPS */}
                                    <div>
                                        <label className="text-sm font-semibold mb-2 block">Tốc độ trích xuất frame
                                            (ms)</label>
                                        <p className="text-xs text-muted-foreground mb-3">
                                            Thời gian giữa mỗi frame. Giá trị nhỏ = chi tiết hơn nhưng chậm hơn
                                        </p>
                                        <div className="flex gap-2 items-center">
                                            <Input
                                                type="number"
                                                min="50"
                                                max="200"
                                                step="10"
                                                value={settings.detectionFps}
                                                onChange={(e) => handleSettingsChange('detectionFps', parseInt(e.target.value))}
                                                className="w-32"
                                            />
                                            <span className="text-sm text-muted-foreground">
                        ≈ {(1000 / settings.detectionFps).toFixed(1)} fps
                      </span>
                                        </div>
                                    </div>

                                    {/* Theme */}
                                    <div>
                                        <label className="text-sm font-semibold mb-2 block">Giao diện</label>
                                        <div className="flex gap-3">
                                            <Button
                                                variant={settings.theme === 'light' ? 'default' : 'outline'}
                                                onClick={() => handleSettingsChange('theme', 'light')}
                                            >
                                                Sáng
                                            </Button>
                                            <Button
                                                variant={settings.theme === 'dark' ? 'default' : 'outline'}
                                                onClick={() => handleSettingsChange('theme', 'dark')}
                                            >
                                                Tối
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Info */}
                                    <div className="pt-6 border-t">
                                        <h3 className="text-sm font-semibold mb-3">Thông tin ứng dụng</h3>
                                        <div className="space-y-2 text-sm text-muted-foreground">
                                            <p>Phiên bản: 1.0.0</p>
                                            <p>Backend: FastAPI</p>
                                            <p>Frontend: Next.js 16</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    )}
                </Tabs>
            </div>
        </div>
    );
}
