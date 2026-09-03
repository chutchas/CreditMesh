import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'CreditMesh',
  description: 'Counterparty credit and collateral intelligence for multi-entity groups',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
