'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Users, FileVideo, Settings, LogOut, Menu, X, Activity } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import './topbar.css';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api').replace(/\/api\/?$/, '');

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('User');
  const [userInitials, setUserInitials] = useState<string>('U');
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchUserRole = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('auth_token');
      if (!token) {
        setUserRole(null);
        setLoading(false);
        router.push('/login');
        return;
      }

      const response = await fetch(`${API_URL}/api/users/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        const userData = await response.json();
        setUserRole(userData.role);
        setUserName(userData.username || userData.email || 'User');
        const initials = userData.username 
          ? userData.username.substring(0, 2).toUpperCase()
          : userData.email?.substring(0, 2).toUpperCase() || 'U';
        setUserInitials(initials);
      } else if (response.status === 401) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('auth_token');
        setUserRole(null);
        router.push('/login');
      } else {
        setUserRole(null);
      }
    } catch (error) {
      console.error('Error fetching user role:', error);
      setUserRole(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (pathname === '/login') return;
    fetchUserRole();
  }, [pathname]);

  const handleLogout = async () => {
    try {
      localStorage.removeItem('access_token');
      localStorage.removeItem('auth_token');
      setUserRole(null);
      setUserName('User');
      setUserInitials('U');
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (pathname === '/login') {
    return null;
  }

  const navItems = [
    { href: '/', label: 'Phát hiện', icon: Home, requireAdmin: false },
    { href: '/users', label: 'Người dùng', icon: Users, requireAdmin: true },
    { href: '/files', label: 'Files', icon: FileVideo, requireAdmin: false },
    { href: '/settings', label: 'Cài đặt', icon: Settings, requireAdmin: false },
  ];

  const visibleItems = navItems.filter(item => {
    if (loading) return !item.requireAdmin; // khi đang load, chỉ hiện item không cần admin
    if (item.requireAdmin && userRole !== 'admin') return false;
    return true;
  });

  return (
    <>
      {/* TopBar */}
      <header className="sticky top-0 z-50 w-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 shadow-lg border-b-4 border-purple-400 topbar-gradient topbar-glow-effect">
        <div className="px-4 md:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Logo - Left */}
            <Link href="/" className="flex items-center gap-2 shrink-0 group">
               <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary rounded-lg">
                        <Activity className="text-white" size={24}/>
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-800">AI Detection System</h1>
                </div>
            </Link>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden text-white hover:bg-white/20 p-2 rounded-lg transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>

            {/* Navigation - Center (Desktop) */}
            <nav className="hidden md:flex items-start gap-5 flex-1 justify-center max-w-2xl mx-auto">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-white/30 text-white shadow-md'
                        : 'text-white/90 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    <Icon size={18} />
                    <span className="hidden lg:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            {/* User Profile - Right */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/20 transition-colors group">
                  <Avatar className="h-8 w-8 border-2 border-white shadow-md">
                    <AvatarImage src="" alt={userName} />
                    <AvatarFallback className="bg-gray-300 text-gray-700 font-medium">
                      {userInitials}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-white dark:bg-slate-950">
                <DropdownMenuLabel className="text-gray-900 dark:text-white">
                  {userName}
                </DropdownMenuLabel>
                <DropdownMenuLabel className="text-xs text-gray-500 dark:text-gray-400 font-normal py-1">
                  {userRole === 'admin' ? 'User' : 'User'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-red-600 cursor-pointer font-medium"
                >
                  <LogOut size={16} className="mr-2" />
                  Đăng xuất
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {mobileMenuOpen && (
            <nav className="md:hidden mt-4 pt-4 border-t border-white/20 space-y-2">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all ${
                      isActive
                        ? 'bg-white/30 text-white'
                        : 'text-white/90 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    <Icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </header>
    </>
  );
}
