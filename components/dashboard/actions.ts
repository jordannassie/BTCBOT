'use server';

import { revalidatePath } from 'next/cache';
import { updateBotSettings } from '@/lib/botData';

export async function updateSettings(updates: {
  is_enabled?: boolean;
  mode?: 'PAPER' | 'LIVE';
  edge_threshold?: number;
  trade_size?: number;
  max_trades_per_hour?: number;
}) {
  try {
    const success = await updateBotSettings(updates);
    
    if (success) {
      revalidatePath('/dashboard');
      revalidatePath('/dashboard/activity');
      return { success: true };
    }
    
    return { success: false, error: 'Failed to update settings' };
  } catch (error) {
    console.error('Server action error:', error);
    return { success: false, error: 'Server error' };
  }
}
