import React from 'react';
import { Link } from 'react-router-dom';
import RegisterPerson from '../components/verification/RegisterPerson';

export default function RegisterWorker() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div>
        {/* <p className="text-[10px] font-black uppercase tracking-[.2em] text-blue-600">Worker database</p> */}
        <h1 className="text-2xl font-black sm:text-3xl">Register Worker</h1>
        <p className="mt-1 text-sm text-slate-500">
          Register each worker once, before they come to work. The registration is permanent: it is never removed
          automatically (not after hours, a session, a refresh or a restart) - only an administrator can delete it from{' '}
          <Link to="/workers" className="font-bold text-blue-600 underline">Registered Workers</Link>.
        </p>
      </div>
      <RegisterPerson />
    </div>
  );
}
