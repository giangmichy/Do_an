'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Nếu không đang tải và người dùng chưa xác thực, chuyển hướng về trang đăng nhập
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Nếu đang tải hoặc đã xác thực, hiển thị nội dung
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500 mb-4"></div>
          <p className="text-slate-600">Đang kiểm tra xác thực...</p>
        </div>
      </div>
    );
  }

  // Nếu chưa xác thực, không hiển thị gì (hiệu ứng chuyển hướng đang diễn ra)
  if (!isAuthenticated) {
    return null;
  }

  // Nếu đã xác thực, hiển thị nội dung con
  return <>{children}</>;
}