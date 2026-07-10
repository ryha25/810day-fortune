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
          created_at: string
          id: string
          participation_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          participation_date: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          participation_date?: string
          user_id?: string
        }
        Relationships: []
      }
      lottery_draws: {
        Row: {
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
        }
        Insert: {
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
        }
        Update: {
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
        }
        Relationships: []
      }
      lottery_result_views: {
        Row: {
          draw_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          draw_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          draw_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      lottery_winners: {
        Row: {
          by_gauge: boolean
          created_at: string
          discord_id: string | null
          draw_date: string
          draw_id: string
          id: string
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
          created_at?: string
          discord_id?: string | null
          draw_date: string
          draw_id: string
          id?: string
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
          created_at?: string
          discord_id?: string | null
          draw_date?: string
          draw_id?: string
          id?: string
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
      calc_redemption_rate: { Args: { _count: number }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      run_daily_draw: {
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
