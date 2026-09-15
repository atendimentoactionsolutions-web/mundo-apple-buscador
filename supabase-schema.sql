-- =========================================================================
-- SCHEMA OFICIAL FORNECEDOR (SUPABASE POSTGRESQL)
-- Cole este script no SQL Editor do Supabase (https://supabase.com) e clique em "RUN"
-- =========================================================================

-- 1. Cria a tabela de lojistas e administradores
create table if not exists lojistas (
  id uuid default gen_random_uuid() primary key,
  store_name text not null,
  owner_name text,
  whatsapp text,
  username text unique not null,
  password_hash text not null,
  role text default 'lojista', -- 'admin' ou 'lojista'
  status text default 'active', -- 'active' ou 'blocked'
  expires_at timestamp with time zone,
  current_session_token text,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- 2. Habilita RLS (Row Level Security) e permite acesso total ao backend (service role)
alter table lojistas enable row level security;

-- Remove políticas antigas se existirem para evitar conflito
drop policy if exists "Permitir acesso total para o backend service role" on lojistas;

-- Cria política permitindo leitura, escrita, atualização e exclusão
create policy "Permitir acesso total para o backend service role"
on lojistas for all
using (true)
with check (true);
