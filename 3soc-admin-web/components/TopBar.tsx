'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, FileVideo, Users, Settings, LogOut, Menu, X, Activity } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import './topbar.css';

export function TopBar() {
  const pathname = usePathname();
  const { user, isAdmin, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    window.location.replace('/login');
  };

  if (pathname === '/login') {
    return null;
  }

  const userName = user?.username || (isLoading ? '' : null);
  const userInitials = user?.username
    ? user.username.substring(0, 2).toUpperCase()
    : '...';

  const allNavItems = [
    { href: '/', label: 'Phát hiện', icon: Home },
    { href: '/files', label: 'Files', icon: FileVideo },
    { href: '/users', label: 'Người dùng', icon: Users },
    { href: '/settings', label: 'Cài đặt', icon: Settings },
  ];

  const visibleItems = isAdmin
    ? allNavItems
    : allNavItems.filter(item => item.href !== '/users');

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
                  {isLoading ? 'Đang tải...' : (isAdmin ? 'Quản trị viên' : 'Người dùng')}
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
