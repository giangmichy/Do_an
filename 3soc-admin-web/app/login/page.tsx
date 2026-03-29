'use client';

import React, {useState} from 'react';
import {useRouter} from 'next/navigation';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Alert, AlertDescription} from '@/components/ui/alert';
import {apiClient} from '@/app/api';
import {Lock, LogIn, Zap} from 'lucide-react';
import {useToast} from '@/hooks/use-toast';

export default function LoginPage() {
    const router = useRouter();
    const {toast} = useToast();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!username || !password) {
            toast({
                title: 'Lỗi',
                description: 'Vui lòng nhập tên đăng nhập và mật khẩu',
                variant: 'destructive'
            });
            return;
        }

        try {
            setLoading(true);
            const response = await apiClient.login({username, password});

            // Token is automatically stored by apiClient.login()
            console.log('[Login] Logged in as:', response.user.username);

            toast({
                title: 'Thành công',
                description: `Chào mừng ${response.user.username}!`
            });

            // Redirect to home/detection page
            setTimeout(() => router.push('/'), 500);
        } catch (err: any) {
            const errorMsg = err.message || 'Đăng nhập thất bại';
            setError(errorMsg);
            toast({
                title: 'Lỗi',
                description: errorMsg,
                variant: 'destructive'
            });
            console.error('[Login] Error:', err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Animated background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div
                    className="absolute top-20 left-10 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
                <div
                    className="absolute top-40 right-10 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
                <div
                    className="absolute -bottom-8 left-20 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>
            </div>

            {/* Content */}
            <div className="relative z-10 w-full">
                <Card className="w-full max-w-md shadow-2xl border-0 bg-white/95 backdrop-blur-md mx-auto">
                    <CardHeader className="text-center pb-2">
                        <div className="flex justify-center mb-4">
                            <div className="p-3 bg-gradient-to-br from-purple-600 to-pink-600 rounded-lg">
                                <Zap className="text-white" size={32}/>
                            </div>
                        </div>
                        <CardTitle
                            className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
                            AI Detection
                        </CardTitle>
                        <p className="text-sm text-muted-foreground mt-2">Sign in to your account</p>
                    </CardHeader>

                    <CardContent>
                        {error && (
                            <Alert variant="destructive" className="mb-6">
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="username" className="text-sm font-semibold">Username</Label>
                                <Input
                                    id="username"
                                    type="text"
                                    placeholder="Enter your username"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    disabled={loading}
                                    autoComplete="username"
                                    className="bg-slate-50 border-slate-200"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password" className="text-sm font-semibold">Password</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    placeholder="Enter your password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={loading}
                                    autoComplete="current-password"
                                    className="bg-slate-50 border-slate-200"
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold"
                                disabled={loading}
                                size="lg"
                            >
                                {loading ? (
                                    <>
                                        <span className="animate-spin inline-block mr-2">⏳</span>
                                        Signing in...
                                    </>
                                ) : (
                                    <>
                                        <LogIn size={18} className="mr-2"/>
                                        Sign In
                                    </>
                                )}
                            </Button>
                        </form>

                        <div className="mt-6 pt-6 border-t border-slate-200">
                            <p className="text-xs text-muted-foreground text-center">
                                Demo accounts:<br/>
                                <span className="font-mono text-slate-700">admin / admin123</span><br/>
                                <span className="font-mono text-slate-700">user / user123</span>
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
        </div>
    );
}
