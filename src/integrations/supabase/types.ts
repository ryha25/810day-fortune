export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      daily_participations: {
        Row: {
          confirm_gauge_incremented: boolean
          created_at: string
          daily_post_participated: boolean
          daily_post_participated_at: string | null
          id: string
          official_follow_participated: boolean
          official_follow_participated_at: string | null
          participation_date: string
          participation_count_incremented: boolean
          result_confirmed: boolean
          user_id: string
        }
        Insert: {
          confirm_gauge_incremented?: boolean
          created_at?: string
          daily_post_participated?: boolean
          daily_post_participated_at?: string | null
          id?: string
          official_follow_participated?: boolean
          official_follow_participated_at?: string | null
          participation_date: string
          participation_count_incremented?: boolean
          result_confirmed?: boolean
          user_id: string
        }
        Update: {
          confirm_gauge_incremented?: boolean
          created_at?: string
          daily_post_participated?: boolean
          daily_post_participated_at?: string | null
          id?: string
          official_follow_participated?: boolean
          official_follow_participated_at?: string | null
          participation_date?: string
          participation_count_incremented?: boolean
          result_confirmed?: boolean
          user_id?: string
        }
        Relationships: []
      }
      participation_stat_days: {
        Row: {
          created_at: string
          participation_date: string
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          participation_date: string
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          participation_date?: string
          source?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_stat_audit_logs: {
        Row: {
          admin_user_id: string
          created_at: string
          field_name: string
          id: string
          new_value: number
          old_value: number
          target_user_id: string
        }
        Insert: {
          admin_user_id: string
          created_at?: string
          field_name: string
          id?: string
          new_value: number
          old_value: number
          target_user_id: string
        }
        Update: {
          admin_user_id?: string
          created_at?: string
          field_name?: string
          id?: string
          new_value?: number
          old_value?: number
          target_user_id?: string
        }
        Relationships: []
      }
      existing_participants: {
        Row: {
          confirm_gauge: number
          created_at: string
          participation_count: number
          redemption_rate: number
          updated_at: string
          win_count: number
          x_id_display: string
          x_id_normalized: string
        }
        Insert: {
          confirm_gauge?: number
          created_at?: string
          participation_count?: number
          redemption_rate?: number
          updated_at?: string
          win_count?: number
          x_id_display: string
          x_id_normalized: string
        }
        Update: {
          confirm_gauge?: number
          created_at?: string
          participation_count?: number
          redemption_rate?: number
          updated_at?: string
          win_count?: number
          x_id_display?: string
          x_id_normalized?: string
        }
        Relationships: []
      }
      lottery_draws: {
        Row: {
          canceled_at: string | null
          created_at: string
          daily_participants_count: number
          daily_winner_by_gauge: boolean
          daily_winner_user_id: string | null
          draw_date: string
          executed_at: string
          follow_participants_count: number
          follow_winner_by_gauge: boolean
          follow_winner_user_id: string | null
          id: string
          is_test: boolean
          test_snapshot: Json | null
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string
          daily_participants_count?: number
          daily_winner_by_gauge?: boolean
          daily_winner_user_id?: string | null
          draw_date: string
          executed_at?: string
          follow_participants_count?: number
          follow_winner_by_gauge?: boolean
          follow_winner_user_id?: string | null
          id?: string
          is_test?: boolean
          test_snapshot?: Json | null
        }
        Update: {
          canceled_at?: string | null
          created_at?: string
          daily_participants_count?: number
          daily_winner_by_gauge?: boolean
          daily_winner_user_id?: string | null
          draw_date?: string
          executed_at?: string
          follow_participants_count?: number
          follow_winner_by_gauge?: boolean
          follow_winner_user_id?: string | null
          id?: string
          is_test?: boolean
          test_snapshot?: Json | null
        }
        Relationships: []
      }
      lottery_result_views: {
        Row: {
          confirmed_at: string | null
          draw_id: string
          result_confirmed: boolean
          seen_at: string
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          draw_id: string
          result_confirmed?: boolean
          seen_at?: string
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          draw_id?: string
          result_confirmed?: boolean
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lottery_winners: {
        Row: {
          by_gauge: boolean
          canceled_at: string | null
          created_at: string
          discord_id: string | null
          draw_date: string
          draw_id: string
          id: string
          is_test: boolean
          kind: string
          redemption_rate: number
          reward_inmu: number
          slot: string
          sol_address: string | null
          user_id: string
          x_id_display: string
          x_id_normalized: string
        }
        Insert: {
          by_gauge?: boolean
          canceled_at?: string | null
          created_at?: string
          discord_id?: string | null
          draw_date: string
          draw_id: string
          id?: string
          is_test?: boolean
          kind: string
          redemption_rate: number
          reward_inmu: number
          slot: string
          sol_address?: string | null
          user_id: string
          x_id_display: string
          x_id_normalized: string
        }
        Update: {
          by_gauge?: boolean
          canceled_at?: string | null
          created_at?: string
          discord_id?: string | null
          draw_date?: string
          draw_id?: string
          id?: string
          is_test?: boolean
          kind?: string
          redemption_rate?: number
          reward_inmu?: number
          slot?: string
          sol_address?: string | null
          user_id?: string
          x_id_display?: string
          x_id_normalized?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auth_token: string | null
          confirm_gauge: number
          created_at: string
          discord_id: string | null
          id: string
          official_follow_registered: boolean
          official_follow_registered_at: string | null
          participation_count: number
          redemption_rate: number
          sol_address: string | null
          updated_at: string
          win_count: number
          x_id_display: string
          x_id_normalized: string
        }
        Insert: {
          auth_token?: string | null
          confirm_gauge?: number
          created_at?: string
          discord_id?: string | null
          id: string
          official_follow_registered?: boolean
          official_follow_registered_at?: string | null
          participation_count?: number
          redemption_rate?: number
          sol_address?: string | null
          updated_at?: string
          win_count?: number
          x_id_display: string
          x_id_normalized: string
        }
        Update: {
          auth_token?: string | null
          confirm_gauge?: number
          created_at?: string
          discord_id?: string | null
          id?: string
          official_follow_registered?: boolean
          official_follow_registered_at?: string | null
          participation_count?: number
          redemption_rate?: number
          sol_address?: string | null
          updated_at?: string
          win_count?: number
          x_id_display?: string
          x_id_normalized?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_update_profile_stats: {
        Args: {
          _admin_user_id: string
          _confirm_gauge: number
          _participation_count: number
          _redemption_rate: number
          _target_user_id: string
          _win_count: number
        }
        Returns: Json
      }
      apply_daily_participation_increment: {
        Args: {
          _participation_date: string
          _source: string
          _user_id: string
        }
        Returns: Json
      }
      calc_redemption_rate: { Args: { _count: number }; Returns: number }
      confirm_draw_result: {
        Args: { _draw_id: string; _user_id: string }
        Returns: Json
      }
      cancel_test_draw: { Args: { _draw_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      record_daily_post_participation: {
        Args: { _participation_date?: string | null; _user_id: string }
        Returns: Json
      }
      record_official_follow_auto_participations: {
        Args: { _participation_date?: string | null }
        Returns: Json
      }
      register_official_follow_participation: {
        Args: { _participation_date?: string | null; _user_id: string }
        Returns: Json
      }
      run_daily_draw: {
        Args: { _draw_date?: string | null }
        Returns: Json
      }
      run_daily_draw_core: {
        Args: { _draw_date: string; _is_test: boolean }
        Returns: Json
      }
      run_test_draw: {
        Args: { _draw_date?: string | null }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
