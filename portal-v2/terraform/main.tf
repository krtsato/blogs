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
