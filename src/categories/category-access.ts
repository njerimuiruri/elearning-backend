/**
 * Frontend logic for Category Access Control
 */

export interface Category {
  _id: string;
  name: string;
  accessType: 'free' | 'paid' | 'restricted';
  allowedRoles: string[]; // e.g. ['fellow']
  price: number;
  paymentRequiredForNonEligible: boolean;
}

export interface User {
  _id: string;
  role: string; // 'student' | 'fellow' | 'admin' | 'instructor'
  purchasedCategoryIds?: string[]; // List of IDs user has paid for
}

export type AccessStatus = 
  | 'allowed'           // Can access immediately
  | 'payment_required'  // Needs to buy
  | 'restricted'        // Not allowed at all (e.g. Fellows only, no buy option)
  | 'login_required';   // Guest user

export function getCategoryAccessStatus(category: Category, user: User | null): AccessStatus {
  // 1. Guest Check
  if (!user) return 'login_required';

  // 2. Admin Override
  if (user.role === 'admin') return 'allowed';

  // 3. Free Categories
  if (category.accessType === 'free') return 'allowed';

  // 4. Restricted Categories (e.g. "AI for Climate Resilience")
  if (category.accessType === 'restricted') {
    // Check if user has the specific role (e.g. "fellow")
    if (category.allowedRoles && category.allowedRoles.includes(user.role)) {
      return 'allowed';
    }
    
    // If not a fellow, check if they can pay for it
    if (category.paymentRequiredForNonEligible) {
      return user.purchasedCategoryIds?.includes(category._id) 
        ? 'allowed' 
        : 'payment_required';
    }
    
    // If they can't pay and aren't a fellow
    return 'restricted';
  }

  // 5. Paid Categories
  if (category.accessType === 'paid') {
    return user.purchasedCategoryIds?.includes(category._id) 
      ? 'allowed' 
      : 'payment_required';
  }

  return 'restricted';
}

export function getAccessLabel(category: Category, status: AccessStatus): string {
  if (status === 'allowed') return 'Access Granted';
  if (status === 'payment_required') return `Buy for $${category.price}`;
  if (status === 'restricted') return `Restricted (${category.allowedRoles?.join(', ') || 'Fellows'} Only)`;
  if (status === 'login_required') return 'Login to View';
  return '';
}