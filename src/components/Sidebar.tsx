"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";

const STORAGE_KEY = "sidebar-collapsed";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    href: "/montage",
    label: "Montage",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsed(true);
    setMounted(true);
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  // Avoid layout shift on first render
  if (!mounted) {
    return <div className="w-[60px] shrink-0" />;
  }

  return (
    <aside
      className={`h-screen sticky top-0 bg-[#0e0e10] border-r border-gray-800 flex flex-col shrink-0 transition-all duration-200 ${
        collapsed ? "w-[60px]" : "w-[200px]"
      }`}
    >
      {/* Logo / Title */}
      <div className="h-14 flex items-center px-4 border-b border-gray-800/50">
        {collapsed ? (
          <span className="text-purple-400 font-bold text-lg mx-auto">L</span>
        ) : (
          <span className="text-white font-bold text-sm whitespace-nowrap">
            <span className="text-purple-400">LoL</span> Clips FR
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                isActive
                  ? "bg-purple-600/20 text-purple-300"
                  : "text-gray-400 hover:text-white hover:bg-[#18181b]"
              } ${collapsed ? "justify-center" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && (
                <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Toggle button */}
      <div className="p-2 border-t border-gray-800/50">
        <button
          onClick={toggle}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-500 hover:text-white hover:bg-[#18181b] transition-colors cursor-pointer ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <svg
            className={`w-5 h-5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7" />
          </svg>
          {!collapsed && <span className="text-sm">Reduire</span>}
        </button>
      </div>
    </aside>
  );
}
