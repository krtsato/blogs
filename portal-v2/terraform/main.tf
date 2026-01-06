# Terraform 例: Cloudflare リソースの雛形（適宜編集してください）

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "cloudflare_api_token" {
  type        = string
  description = "Cloudflare API Token"
}

variable "account_id" {
  type        = string
  description = "Cloudflare Account ID"
}

variable "r2_bucket_attachments" {
  type        = string
  description = "R2 bucket name for attachments"
}

variable "kv_reactions" {
  type        = string
  description = "KV namespace for reactions"
}

variable "kv_nowplaying" {
  type        = string
  description = "KV namespace for nowplaying list cache"
}

variable "d1_database_name" {
  type        = string
  description = "D1 database name for portal-v2"
}

variable "vectorize_index_name" {
  type        = string
  description = "Vectorize index name (for search semantic index)"
}

# R2 バケット (添付ファイル)
resource "cloudflare_r2_bucket" "attachments" {
  account_id = var.account_id
  name       = var.r2_bucket_attachments
}

# KV 名前空間
resource "cloudflare_workers_kv_namespace" "reactions" {
  title      = var.kv_reactions
  account_id = var.account_id
}

resource "cloudflare_workers_kv_namespace" "nowplaying" {
  title      = var.kv_nowplaying
  account_id = var.account_id
}

# D1 データベース
resource "cloudflare_d1_database" "portal" {
  account_id = var.account_id
  name       = var.d1_database_name
}

# Vectorize インデックス
resource "cloudflare_vectorize_index" "semantic" {
  account_id  = var.account_id
  name        = var.vectorize_index_name
  description = "portal-v2 semantic search index"
  dimension   = 1536
  metric      = "cosine"
}

output "d1_database_id" {
  value = cloudflare_d1_database.portal.id
}

output "vectorize_index_id" {
  value = cloudflare_vectorize_index.semantic.id
}
