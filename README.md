# DB Manager - AI-Powered PostgreSQL Database Manager

A modern, web-based database management tool for PostgreSQL with AI-powered natural language to SQL conversion using Google Gemini.

## Features

- 🔐 **Secure Connection Management**: Encrypted local storage for database credentials
- 🌳 **Database Navigator**: Browse schemas, tables, and columns with a tree view
- 📊 **Table Viewer**: View and export table data with pagination
- 🔍 **SQL Query Editor**: Monaco Editor with syntax highlighting and autocomplete
- 🤖 **AI Query Assistant**: Convert natural language to SQL using Google Gemini
- 📱 **Responsive Design**: Clean, minimal interface built with Tailwind CSS
- 🚀 **Client-Side Only**: No server-side data storage, everything runs locally

## Tech Stack

- **Frontend**: Next.js 14 with App Router, React, TypeScript
- **Styling**: Tailwind CSS
- **Database**: PostgreSQL connection via node-postgres
- **AI**: Google Gemini API for natural language processing
- **Security**: Client-side encryption with crypto-js
- **Editor**: Monaco Editor for SQL syntax highlighting

## Prerequisites

- Node.js 18+
- A PostgreSQL database to connect to
- Google Gemini API key (optional, for AI features)

## Installation

1. Install dependencies:

```bash
npm install
```

2. Start the development server:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser

## Setup

### Database Connection

1. Click "Add" in the Connections panel
2. Fill in your PostgreSQL connection details
3. Click "Test Connection" to verify
4. Click "Create" to save the connection

**Note**: All connection details are encrypted and stored locally in your browser.

### AI Features (Optional)

1. Get a Google Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click the "AI Assistant" button
3. Enter your API key when prompted

## Usage

### Database Navigation

- Click on a connection to connect and browse the database
- Expand schemas to see tables
- Click on a table to view its structure and data

### Query Editor

- Write and execute SQL queries
- Use AI Assistant for natural language queries
- Export results as CSV

## Security

- **No Server-Side Storage**: All data remains on your local machine
- **Encrypted Credentials**: Database connections are encrypted using AES
- **Local API Keys**: Gemini API keys are encrypted and stored locally
- **Client-Side Only**: No sensitive data is sent to any servers

## Deployment

The application is optimized for deployment on Vercel and works entirely client-side.
