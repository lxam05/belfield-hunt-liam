export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      api_usage: {
        Row: {
          count: number;
          month: string;
          provider: string;
          sku: string;
        };
        ComputedFields: never;
        Insert: {
          count?: number;
          month: string;
          provider: string;
          sku: string;
        };
        Update: {
          count?: number;
          month?: string;
          provider?: string;
          sku?: string;
        };
        Relationships: [];
      };
      commutes: {
        Row: {
          computed_at: string;
          destination_id: string;
          distance_m: number | null;
          id: string;
          lines: string[];
          listing_id: number;
          minutes: number | null;
          mode: Database["public"]["Enums"]["commute_mode"];
          source: string;
          transfers: number | null;
          walk_minutes: number | null;
        };
        ComputedFields: never;
        Insert: {
          computed_at?: string;
          destination_id: string;
          distance_m?: number | null;
          id?: string;
          lines?: string[];
          listing_id: number;
          minutes?: number | null;
          mode: Database["public"]["Enums"]["commute_mode"];
          source?: string;
          transfers?: number | null;
          walk_minutes?: number | null;
        };
        Update: {
          computed_at?: string;
          destination_id?: string;
          distance_m?: number | null;
          id?: string;
          lines?: string[];
          listing_id?: number;
          minutes?: number | null;
          mode?: Database["public"]["Enums"]["commute_mode"];
          source?: string;
          transfers?: number | null;
          walk_minutes?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "commutes_destination_id_fkey";
            columns: ["destination_id"];
            isOneToOne: false;
            referencedRelation: "destinations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commutes_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_log: {
        Row: {
          at: string;
          channel: Database["public"]["Enums"]["contact_channel"];
          id: string;
          listing_id: number;
          member_id: string;
          outcome: string | null;
        };
        ComputedFields: never;
        Insert: {
          at?: string;
          channel: Database["public"]["Enums"]["contact_channel"];
          id?: string;
          listing_id: number;
          member_id: string;
          outcome?: string | null;
        };
        Update: {
          at?: string;
          channel?: Database["public"]["Enums"]["contact_channel"];
          id?: string;
          listing_id?: number;
          member_id?: string;
          outcome?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contact_log_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_log_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      destinations: {
        Row: {
          address: string;
          created_at: string;
          emoji: string;
          group_id: string;
          id: string;
          is_intern_site: boolean;
          lat: number;
          lng: number;
          name: string;
          short_name: string;
          sort_order: number;
          weight: number;
          who_commutes: string[];
        };
        ComputedFields: never;
        Insert: {
          address: string;
          created_at?: string;
          emoji?: string;
          group_id: string;
          id?: string;
          is_intern_site?: boolean;
          lat: number;
          lng: number;
          name: string;
          short_name: string;
          sort_order?: number;
          weight?: number;
          who_commutes?: string[];
        };
        Update: {
          address?: string;
          created_at?: string;
          emoji?: string;
          group_id?: string;
          id?: string;
          is_intern_site?: boolean;
          lat?: number;
          lng?: number;
          name?: string;
          short_name?: string;
          sort_order?: number;
          weight?: number;
          who_commutes?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "destinations_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          at: string;
          data: NonNullable<Json>;
          id: number;
          kind: string;
          level: string;
          message: string;
        };
        ComputedFields: never;
        Insert: {
          at?: string;
          data?: NonNullable<Json>;
          id?: number;
          kind: string;
          level?: string;
          message: string;
        };
        Update: {
          at?: string;
          data?: NonNullable<Json>;
          id?: number;
          kind?: string;
          level?: string;
          message?: string;
        };
        Relationships: [];
      };
      geocode_cache: {
        Row: {
          created_at: string;
          formatted_address: string | null;
          lat: number | null;
          lng: number | null;
          precision: string | null;
          query: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          formatted_address?: string | null;
          lat?: number | null;
          lng?: number | null;
          precision?: string | null;
          query: string;
        };
        Update: {
          created_at?: string;
          formatted_address?: string | null;
          lat?: number | null;
          lng?: number | null;
          precision?: string | null;
          query?: string;
        };
        Relationships: [];
      };
      groups: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      listings: {
        Row: {
          area: string | null;
          baths: number | null;
          beds: number | null;
          beds_max: number | null;
          beds_min: number | null;
          daft_shortcode: string | null;
          eircode: string | null;
          enriched_at: string | null;
          featured_level: string | null;
          first_seen_at: string;
          geocode_precision: string | null;
          has_video: boolean;
          has_virtual_tour: boolean;
          id: number;
          image_count: number;
          image_cover: string | null;
          images: string[];
          is_development: boolean;
          last_seen_at: string;
          last_swept_at: string | null;
          lat: number | null;
          lng: number | null;
          missed_sweeps: number;
          monthly_rent: number | null;
          price_is_from: boolean;
          price_on_application: boolean;
          price_text: string | null;
          property_type: string | null;
          published_at: string | null;
          raw: NonNullable<Json>;
          raw_url: string | null;
          score: number | null;
          seller_name: string | null;
          seller_phone: string | null;
          status: Database["public"]["Enums"]["listing_status"];
          suburb: string | null;
          title: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          area?: string | null;
          baths?: number | null;
          beds?: number | null;
          beds_max?: number | null;
          beds_min?: number | null;
          daft_shortcode?: string | null;
          eircode?: string | null;
          enriched_at?: string | null;
          featured_level?: string | null;
          first_seen_at?: string;
          geocode_precision?: string | null;
          has_video?: boolean;
          has_virtual_tour?: boolean;
          id: number;
          image_count?: number;
          image_cover?: string | null;
          images?: string[];
          is_development?: boolean;
          last_seen_at?: string;
          last_swept_at?: string | null;
          lat?: number | null;
          lng?: number | null;
          missed_sweeps?: number;
          monthly_rent?: number | null;
          price_is_from?: boolean;
          price_on_application?: boolean;
          price_text?: string | null;
          property_type?: string | null;
          published_at?: string | null;
          raw?: NonNullable<Json>;
          raw_url?: string | null;
          score?: number | null;
          seller_name?: string | null;
          seller_phone?: string | null;
          status?: Database["public"]["Enums"]["listing_status"];
          suburb?: string | null;
          title: string;
          url: string;
        };
        Update: {
          area?: string | null;
          baths?: number | null;
          beds?: number | null;
          beds_max?: number | null;
          beds_min?: number | null;
          daft_shortcode?: string | null;
          eircode?: string | null;
          enriched_at?: string | null;
          featured_level?: string | null;
          first_seen_at?: string;
          geocode_precision?: string | null;
          has_video?: boolean;
          has_virtual_tour?: boolean;
          id?: number;
          image_count?: number;
          image_cover?: string | null;
          images?: string[];
          is_development?: boolean;
          last_seen_at?: string;
          last_swept_at?: string | null;
          lat?: number | null;
          lng?: number | null;
          missed_sweeps?: number;
          monthly_rent?: number | null;
          price_is_from?: boolean;
          price_on_application?: boolean;
          price_text?: string | null;
          property_type?: string | null;
          published_at?: string | null;
          raw?: NonNullable<Json>;
          raw_url?: string | null;
          score?: number | null;
          seller_name?: string | null;
          seller_phone?: string | null;
          status?: Database["public"]["Enums"]["listing_status"];
          suburb?: string | null;
          title?: string;
          url?: string;
        };
        Relationships: [];
      };
      members: {
        Row: {
          colour: string;
          commute_mode: string;
          created_at: string;
          display_name: string;
          email: string;
          group_id: string;
          id: string;
          interns_at_sandyford: boolean;
          role: Database["public"]["Enums"]["member_role"];
          telegram_user_id: number | null;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          colour?: string;
          commute_mode?: string;
          created_at?: string;
          display_name: string;
          email: string;
          group_id: string;
          id?: string;
          interns_at_sandyford?: boolean;
          role?: Database["public"]["Enums"]["member_role"];
          telegram_user_id?: number | null;
          user_id?: string | null;
        };
        Update: {
          colour?: string;
          commute_mode?: string;
          created_at?: string;
          display_name?: string;
          email?: string;
          group_id?: string;
          id?: string;
          interns_at_sandyford?: boolean;
          role?: Database["public"]["Enums"]["member_role"];
          telegram_user_id?: number | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "members_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          listing_id: number;
          member_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          listing_id: number;
          member_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          listing_id?: number;
          member_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notes_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notes_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          channel: string;
          listing_id: number;
          message_id: string | null;
          sent_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel: string;
          listing_id: number;
          message_id?: string | null;
          sent_at?: string;
        };
        Update: {
          channel?: string;
          listing_id?: number;
          message_id?: string | null;
          sent_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      pipeline: {
        Row: {
          claimed_at: string | null;
          claimed_by: string | null;
          hidden: boolean;
          hidden_by: string | null;
          listing_id: number;
          manual_rank: number | null;
          next_action: string | null;
          next_action_at: string | null;
          pinned: boolean;
          stage: Database["public"]["Enums"]["pipeline_stage"];
          updated_at: string;
          viewing_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          claimed_at?: string | null;
          claimed_by?: string | null;
          hidden?: boolean;
          hidden_by?: string | null;
          listing_id: number;
          manual_rank?: number | null;
          next_action?: string | null;
          next_action_at?: string | null;
          pinned?: boolean;
          stage?: Database["public"]["Enums"]["pipeline_stage"];
          updated_at?: string;
          viewing_at?: string | null;
        };
        Update: {
          claimed_at?: string | null;
          claimed_by?: string | null;
          hidden?: boolean;
          hidden_by?: string | null;
          listing_id?: number;
          manual_rank?: number | null;
          next_action?: string | null;
          next_action_at?: string | null;
          pinned?: boolean;
          stage?: Database["public"]["Enums"]["pipeline_stage"];
          updated_at?: string;
          viewing_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pipeline_claimed_by_fkey";
            columns: ["claimed_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pipeline_hidden_by_fkey";
            columns: ["hidden_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pipeline_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: true;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          member_id: string;
          p256dh: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          member_id: string;
          p256dh: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          member_id?: string;
          p256dh?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      scrape_runs: {
        Row: {
          apify_run_id: string;
          cost_usd: number;
          dataset_id: string | null;
          error: string | null;
          event_type: string | null;
          finished_at: string | null;
          items: number;
          kind: string;
          new_items: number;
          notified: number;
          received_at: string;
          status: string;
          task_id: string | null;
          updated_items: number;
        };
        ComputedFields: never;
        Insert: {
          apify_run_id: string;
          cost_usd?: number;
          dataset_id?: string | null;
          error?: string | null;
          event_type?: string | null;
          finished_at?: string | null;
          items?: number;
          kind?: string;
          new_items?: number;
          notified?: number;
          received_at?: string;
          status?: string;
          task_id?: string | null;
          updated_items?: number;
        };
        Update: {
          apify_run_id?: string;
          cost_usd?: number;
          dataset_id?: string | null;
          error?: string | null;
          event_type?: string | null;
          finished_at?: string | null;
          items?: number;
          kind?: string;
          new_items?: number;
          notified?: number;
          received_at?: string;
          status?: string;
          task_id?: string | null;
          updated_items?: number;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          apify_fast_schedule_id: string | null;
          apify_fast_task_id: string | null;
          apify_provisioned_at: string | null;
          apify_sweep_schedule_id: string | null;
          apify_sweep_task_id: string | null;
          apify_webhook_ids: string[];
          beds_max: number;
          beds_min: number;
          daft_location_slugs: string[];
          fast_lane_cron: string;
          fast_lane_results_wanted: number;
          group_id: string;
          group_profile: NonNullable<Json>;
          group_size_max: number;
          group_size_min: number;
          max_per_person: number;
          notify_score_threshold: number;
          score_weights: NonNullable<Json>;
          sweep_cron: string;
          sweep_results_wanted: number;
          templates: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          apify_fast_schedule_id?: string | null;
          apify_fast_task_id?: string | null;
          apify_provisioned_at?: string | null;
          apify_sweep_schedule_id?: string | null;
          apify_sweep_task_id?: string | null;
          apify_webhook_ids?: string[];
          beds_max?: number;
          beds_min?: number;
          daft_location_slugs?: string[];
          fast_lane_cron?: string;
          fast_lane_results_wanted?: number;
          group_id: string;
          group_profile?: NonNullable<Json>;
          group_size_max?: number;
          group_size_min?: number;
          max_per_person?: number;
          notify_score_threshold?: number;
          score_weights?: NonNullable<Json>;
          sweep_cron?: string;
          sweep_results_wanted?: number;
          templates?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          apify_fast_schedule_id?: string | null;
          apify_fast_task_id?: string | null;
          apify_provisioned_at?: string | null;
          apify_sweep_schedule_id?: string | null;
          apify_sweep_task_id?: string | null;
          apify_webhook_ids?: string[];
          beds_max?: number;
          beds_min?: number;
          daft_location_slugs?: string[];
          fast_lane_cron?: string;
          fast_lane_results_wanted?: number;
          group_id?: string;
          group_profile?: NonNullable<Json>;
          group_size_max?: number;
          group_size_min?: number;
          max_per_person?: number;
          notify_score_threshold?: number;
          score_weights?: NonNullable<Json>;
          sweep_cron?: string;
          sweep_results_wanted?: number;
          templates?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "settings_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: true;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      votes: {
        Row: {
          listing_id: number;
          member_id: string;
          stars: number | null;
          updated_at: string;
          value: number;
        };
        ComputedFields: never;
        Insert: {
          listing_id: number;
          member_id: string;
          stars?: number | null;
          updated_at?: string;
          value?: number;
        };
        Update: {
          listing_id?: number;
          member_id?: string;
          stars?: number | null;
          updated_at?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "votes_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "votes_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_listing: { Args: { p_listing_id: number }; Returns: string };
      claim_listing_as: { Args: { p_listing_id: number; p_member_id: string }; Returns: string };
      current_member_id: { Args: Record<PropertyKey, never>; Returns: string };
      increment_api_usage: {
        Args: { p_month: string; p_n?: number; p_provider: string; p_sku: string };
        Returns: number;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_member: { Args: Record<PropertyKey, never>; Returns: boolean };
      unclaim_listing: { Args: { p_listing_id: number }; Returns: undefined };
    };
    Enums: {
      commute_mode: "transit" | "transit_return" | "bicycle" | "walk";
      contact_channel: "email" | "phone" | "daft-form" | "whatsapp";
      listing_status: "active" | "possibly_gone" | "gone";
      member_role: "admin" | "member";
      pipeline_stage:
        | "new"
        | "shortlisted"
        | "contacting"
        | "contacted"
        | "viewing_booked"
        | "viewed"
        | "applied"
        | "offer"
        | "rejected"
        | "gone";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      commute_mode: ["transit", "transit_return", "bicycle", "walk"],
      contact_channel: ["email", "phone", "daft-form", "whatsapp"],
      listing_status: ["active", "possibly_gone", "gone"],
      member_role: ["admin", "member"],
      pipeline_stage: [
        "new",
        "shortlisted",
        "contacting",
        "contacted",
        "viewing_booked",
        "viewed",
        "applied",
        "offer",
        "rejected",
        "gone",
      ],
    },
  },
} as const;
